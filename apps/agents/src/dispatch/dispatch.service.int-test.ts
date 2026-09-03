import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  CreateQueueCommand,
} from '@aws-sdk/client-sqs';
import { ulid } from 'ulid';
import { EngineJobMessageSchema } from '@marketplace/contracts';
import { DispatchService } from './dispatch.service';
import { EnvConfig } from '../config/env.schema';

const sqsEndpoint = process.env.SQS_ENDPOINT ?? 'http://localhost:34566';

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: sqsEndpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

jest.setTimeout(60_000);

let env: EnvConfig;
let service: DispatchService;

async function drain(queueUrl: string, predicate: (body: any) => boolean): Promise<any[]> {
  const found: any[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
    );
    for (const m of out.Messages ?? []) {
      const body = JSON.parse(m.Body!);
      if (predicate(body)) found.push(body);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
    }
    if (found.length > 0) break;
  }
  return found;
}

/**
 * Like `drain`, but never stops early on the first match: it exhausts the
 * whole window so a genuine duplicate delivery (the bug this is meant to
 * catch) has a chance to show up even if it doesn't arrive in the same
 * receive batch as the first message.
 */
async function collectAll(queueUrl: string, predicate: (body: any) => boolean, windowMs: number): Promise<any[]> {
  const found: any[] = [];
  const deadline = Date.now() + windowMs;
  while (Date.now() < deadline) {
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
    );
    for (const m of out.Messages ?? []) {
      const body = JSON.parse(m.Body!);
      if (predicate(body)) found.push(body);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
    }
  }
  return found;
}

/**
 * Deletes every message currently on the queue, not just the ones a test is
 * looking for. Used to start each run from an empty queue: unlike the shared
 * job queue, this one is reused across test runs (`CreateQueue` is
 * idempotent), so a previous failed run can leave messages behind that would
 * otherwise satisfy a later test's predicate for the wrong reason.
 *
 * Not `PurgeQueueCommand`: on a real FIFO queue that command is rate-limited
 * to once per 60 seconds, which would break a rerun within a minute.
 * Draining message-by-message has no such limit.
 */
async function purge(queueUrl: string): Promise<void> {
  for (;;) {
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }),
    );
    if (!out.Messages || out.Messages.length === 0) break;
    for (const m of out.Messages) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle! }));
    }
  }
}

describe('DispatchService', () => {
  beforeAll(async () => {
    // A dedicated queue, not the shared job queue the Engine's own SQS
    // consumer is polling: that consumer wins the race for every message
    // deterministically (verified against its logs), so a test sharing the
    // queue can never observe what it sent. This test is about DispatchService
    // alone -- what it puts on a queue, and that the same proposal dispatched
    // twice yields one message. Proving the real queue reaches the Engine is a
    // separate, API-level concern for a later task.
    const created = await sqs.send(
      new CreateQueueCommand({
        QueueName: 'agents-dispatch-int-test.fifo',
        Attributes: {
          FifoQueue: 'true',
          // Deliberately no ContentBasedDeduplication: this suite asserts on
          // the explicitly supplied MessageDeduplicationId, and content-based
          // dedup would mask a broken derivation.
        },
      }),
    );

    env = {
      AWS_REGION: 'us-east-1',
      SQS_ENDPOINT: sqsEndpoint,
      QUEUE_URL: created.QueueUrl!,
    } as EnvConfig;
    service = new DispatchService(env);

    await purge(env.QUEUE_URL);
  });

  it('puts a contract-valid PROPOSE_FLOW message on the queue', async () => {
    const threadId = ulid();
    const field = `f_${Math.random().toString(36).slice(2, 8)}`;

    await service.dispatch({
      threadId,
      tenantId: 'tenant_disp',
      targetEntity: 'Event',
      payload: { addedFields: [{ name: field, type: 'string', required: false, default: null }] },
    });

    const [body] = await drain(env.QUEUE_URL, (b) => b?.payload?.addedFields?.[0]?.name === field);
    expect(body).toBeDefined();
    expect(() => EngineJobMessageSchema.parse(body)).not.toThrow();
    expect(body.tenantId).toBe('TENANT#tenant_disp');
    expect(body.metadata.threadId).toBe(threadId);
  });

  it('collapses two dispatches of the same proposal into one message on the queue', async () => {
    // This is the property `ContentBasedDeduplication` was deliberately left
    // off for: it proves the WIRED `MessageDeduplicationId` -- not some
    // implicit SQS behaviour -- is what collapses a genuine duplicate send.
    // Passing the derived id to the wrong SendMessageCommand field, or
    // deriving it from the wrong inputs, would sail through the static
    // `deduplicationId()` case below without this one to catch it.
    const threadId = ulid();
    const field = `f_${Math.random().toString(36).slice(2, 8)}`;
    const payload = { addedFields: [{ name: field, type: 'string' as const, required: false, default: null }] };

    await service.dispatch({ threadId, tenantId: 'tenant_disp', targetEntity: 'Event', payload });
    await service.dispatch({ threadId, tenantId: 'tenant_disp', targetEntity: 'Event', payload });

    const matches = await collectAll(env.QUEUE_URL, (b) => b?.payload?.addedFields?.[0]?.name === field, 8_000);
    expect(matches).toHaveLength(1);
  });

  it('rejects a payload the engine contract would not accept', async () => {
    await expect(
      service.dispatch({
        threadId: ulid(),
        tenantId: 'tenant_disp',
        targetEntity: 'Event',
        payload: { addedFields: [] } as never,
      }),
    ).rejects.toThrow();
  });

  it('produces a stable deduplication id for the same thread and payload', () => {
    const args = {
      threadId: '01J8Z5X9T7QK4W2M6N3P8R5V1C',
      payload: { addedFields: [{ name: 'a', type: 'string' as const, required: false, default: null }] },
    };
    expect(DispatchService.deduplicationId(args.threadId, args.payload)).toBe(
      DispatchService.deduplicationId(args.threadId, args.payload),
    );
    expect(DispatchService.deduplicationId('01J8Z5X9T7QK4W2M6N3P8R5V1D', args.payload)).not.toBe(
      DispatchService.deduplicationId(args.threadId, args.payload),
    );
  });
});
