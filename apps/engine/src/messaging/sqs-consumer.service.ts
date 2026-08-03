import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import Redis from 'ioredis';
import { EngineJobMessageSchema } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';
import { FlowsService } from '../flows/flows.service';
import { runWithTenant } from '../common/tenant-context';
import { normalizeTenantId } from '../persistence/keys';
import { TENANT_ID_PATTERN } from '../auth/claims';
import { deriveIdFrom } from '../common/ids';

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Consumes `PROPOSE_FLOW` messages that MarketplaceAgents (a separate, unbuilt service) pushes
 * onto the FIFO job queue, and turns each one into a Flow at `status: 'proposed'`.
 *
 * This is the AI side of the platform's schema-change handshake: a language model may *propose*
 * a schema change, but nothing here ever applies one. `FlowsService.propose` always creates a
 * Flow in the `proposed` state -- a human must call `POST /flows/:id/execute` to actually mutate
 * the tenant's registry. That is the entire reason this consumer exists as a separate path from
 * `POST /flows`, rather than the agent service just calling the HTTP API directly: it keeps "an
 * LLM suggested this" and "a human approved this" as two distinct, auditable steps.
 *
 * Every other entry point derives tenantId from a verified JWT claim (see
 * `auth/claims.ts::principalFromClaims`), validated against `TENANT_ID_PATTERN` before it is
 * ever trusted. This consumer is a second, *unauthenticated* entry point for a tenant id --
 * `EngineJobMessageSchema` only requires `tenantId` to be a non-empty string -- and it feeds
 * straight into `runWithTenant`, which feeds straight into single-table partition keys such as
 * `TENANT#<tenantId>`. `handle()` re-validates the normalised tenant id against that exact same
 * pattern before it is ever used, so a crafted message body can't smuggle a `#`/`/` into a key.
 *
 * SQS delivers at least once, so a redelivered message must not create a second Flow. The Redis
 * claim below (`sqsmsg:<messageId>`) is a fast-path optimisation that skips the DynamoDB round
 * trip on the common case, but it is not the correctness guarantee: `flows.propose` is called
 * with a Flow id deterministically derived from `message.MessageId` (`deriveIdFrom`) and written
 * with `putIfAbsent`, so the write itself is idempotent. That matters because the Redis claim
 * alone cannot distinguish "definitely not written" from "outcome unknown" -- e.g. the write
 * committed in DynamoDB but the client timed out before seeing the response, so this method's
 * catch block released the claim and the message gets redelivered. Without a deterministic id,
 * that redelivery would call `propose` again with a fresh random id and create a second Flow.
 */
@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly flows: FlowsService,
  ) {
    this.sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
  }

  onModuleInit(): void {
    if (!this.env.SQS_CONSUMER_ENABLED) return;
    this.running = true;
    this.loop = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
    this.sqs.destroy();
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const out = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.env.QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
          }),
        );
        for (const message of out.Messages ?? []) {
          if (!this.running) break;
          await this.handle(message);
        }
      } catch (err) {
        this.logger.error({ err, msg: 'sqs receive failed' });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(message: Message): Promise<void> {
    const messageId = message.MessageId;
    if (!messageId) {
      // `Message.MessageId` is typed optional by the AWS SDK (SQS always sets it in practice,
      // but nothing in the type system guarantees it). Both the dedupe key and the deterministic
      // Flow id below are derived from it; deriving from the literal string "undefined" would
      // make every such message collide on the same dedupe key and the same Flow id, which is
      // worse than just refusing to process it. Left unacknowledged like any other malformed
      // message, so it still reaches the DLQ after five receives.
      this.logger.error({ msg: 'sqs message has no MessageId; leaving unacknowledged' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(message.Body ?? '{}');
    } catch (err) {
      // Left unacknowledged on purpose, same as a schema-parse failure below: the queue's
      // redrive policy (maxReceiveCount: 5) moves it to the DLQ, where an operator can inspect
      // the raw body. A malformed body will never become valid on redelivery, but silently
      // deleting it would erase the evidence of why it was malformed.
      this.logger.error({ messageId, err, msg: 'sqs message body is not valid JSON' });
      return;
    }

    const parsed = EngineJobMessageSchema.safeParse(body);
    if (!parsed.success) {
      // Left unacknowledged on purpose: the redrive policy moves it to the DLQ.
      this.logger.error({ messageId, issues: parsed.error.issues, msg: 'invalid job message' });
      return;
    }

    const job = parsed.data;
    const tenantId = normalizeTenantId(job.tenantId);
    if (!TENANT_ID_PATTERN.test(tenantId)) {
      // Security chokepoint, not a data-quality one: a message that fails this check has either
      // an upstream bug in MarketplaceAgents or is a deliberate attempt to smuggle a key-
      // confusion character (`#`, `/`, ...) into a tenant partition key. Either way it is left
      // unacknowledged rather than deleted -- a malformed tenant id will never become valid on
      // retry, so the redrive-to-DLQ path exists purely for forensics: an operator should be
      // able to see exactly what was sent, not have it vanish silently. No Flow is created.
      this.logger.error({ messageId, tenantId: job.tenantId, msg: 'rejected job message: malformed tenant id' });
      return;
    }

    const dedupeKey = `sqsmsg:${messageId}`;
    // Fast-path only: skips the DynamoDB round trip on the common redelivery case. It is not
    // the correctness guarantee -- see the class-level doc comment for why `flows.propose`
    // below (a deterministic id + `putIfAbsent`) is what actually prevents a duplicate Flow.
    const claimed = await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');

    if (claimed === 'OK') {
      try {
        await runWithTenant({ tenantId, userId: 'system:agents', role: 'system' }, () =>
          this.flows.propose(
            {
              targetEntity: job.targetEntity,
              actionType: 'ADD_FIELDS',
              blueprintDiff: job.payload,
            },
            deriveIdFrom(messageId),
          ),
        );
        this.logger.log({ messageId, tenantId, msg: 'flow proposed' });
      } catch (err) {
        // Release the claim: if this had been left in place, a genuine retry of a message whose
        // Flow was never actually created (e.g. a transient DynamoDB failure) would find the key
        // already claimed and silently skip proposing anything for the rest of the TTL. This is
        // safe now that the Flow id is deterministic -- a retry after this release lands on
        // exactly the same id, so `putIfAbsent` still can't produce a duplicate even if the
        // original write actually did succeed and only the client-side ack was lost. Not
        // deleting the SQS message here means it becomes visible again after the visibility
        // timeout and is retried.
        await this.redis.del(dedupeKey);
        throw err;
      }
    }

    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: this.env.QUEUE_URL, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}
