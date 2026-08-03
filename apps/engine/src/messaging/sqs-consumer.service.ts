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
    let body: unknown;
    try {
      body = JSON.parse(message.Body ?? '{}');
    } catch (err) {
      // Left unacknowledged on purpose, same as a schema-parse failure below: the queue's
      // redrive policy (maxReceiveCount: 5) moves it to the DLQ, where an operator can inspect
      // the raw body. A malformed body will never become valid on redelivery, but silently
      // deleting it would erase the evidence of why it was malformed.
      this.logger.error({ messageId: message.MessageId, err, msg: 'sqs message body is not valid JSON' });
      return;
    }

    const parsed = EngineJobMessageSchema.safeParse(body);
    if (!parsed.success) {
      // Left unacknowledged on purpose: the redrive policy moves it to the DLQ.
      this.logger.error(
        { messageId: message.MessageId, issues: parsed.error.issues, msg: 'invalid job message' },
      );
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
      this.logger.error(
        { messageId: message.MessageId, tenantId: job.tenantId, msg: 'rejected job message: malformed tenant id' },
      );
      return;
    }

    const dedupeKey = `sqsmsg:${message.MessageId}`;
    // SQS delivers at least once, so a redelivered message must not create a second Flow. The
    // NX claim below is atomic across concurrent consumers/redeliveries: only the first caller
    // to see this messageId gets 'OK' and actually proposes a Flow.
    const claimed = await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX');

    if (claimed === 'OK') {
      try {
        await runWithTenant({ tenantId, userId: 'system:agents', role: 'system' }, () =>
          this.flows.propose({
            targetEntity: job.targetEntity,
            actionType: 'ADD_FIELDS',
            blueprintDiff: job.payload,
          }),
        );
        this.logger.log({ messageId: message.MessageId, tenantId, msg: 'flow proposed' });
      } catch (err) {
        // Release the claim: if this had been left in place, a genuine retry of a message whose
        // Flow was never actually created (e.g. a transient DynamoDB failure) would find the key
        // already claimed and silently skip proposing anything for the rest of the TTL. Not
        // deleting the SQS message here means it becomes visible again after the visibility
        // timeout and is retried -- this time able to re-claim the now-released key.
        await this.redis.del(dedupeKey);
        throw err;
      }
    }

    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: this.env.QUEUE_URL, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}
