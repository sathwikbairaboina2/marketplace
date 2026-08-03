import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  BlueprintDiff,
  DynamicEntityType,
  EngineJobMessage,
  EngineJobMessageSchema,
} from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { canonicalJson } from '../common/canonical-json';

export interface DispatchArgs {
  threadId: string;
  tenantId: string;
  targetEntity: DynamicEntityType;
  payload: BlueprintDiff;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private readonly sqs: SQSClient;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
  }

  /**
   * Derived rather than random, so a retried dispatch — after a socket drop or
   * a resumed thread — collapses into the original inside the FIFO queue's
   * five-minute deduplication window instead of proposing twice.
   */
  static deduplicationId(threadId: string, payload: BlueprintDiff): string {
    return createHash('sha256').update(`${threadId}:${canonicalJson(payload)}`).digest('hex');
  }

  async dispatch(args: DispatchArgs): Promise<string> {
    const groupId = `TENANT#${args.tenantId}`;

    // Parsed, not cast: whatever the model produced, an unparseable body never
    // reaches the queue.
    const body: EngineJobMessage = EngineJobMessageSchema.parse({
      action: 'PROPOSE_FLOW',
      targetEntity: args.targetEntity,
      tenantId: groupId,
      payload: args.payload,
      metadata: { threadId: args.threadId },
    });

    try {
      const out = await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.env.QUEUE_URL,
          // The tenant, per the PRD: schema updates for one tenant stay ordered.
          MessageGroupId: groupId,
          MessageDeduplicationId: DispatchService.deduplicationId(args.threadId, args.payload),
          MessageBody: JSON.stringify(body),
        }),
      );
      this.logger.log({ threadId: args.threadId, tenantId: args.tenantId, messageId: out.MessageId }, 'flow proposed');
      return out.MessageId!;
    } catch (err) {
      throw new ProblemException('dispatch-failed', 502, 'Could not queue the proposal', (err as Error).message);
    }
  }
}
