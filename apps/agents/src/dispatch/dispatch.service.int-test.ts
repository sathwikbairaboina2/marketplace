import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { ulid } from 'ulid';
import { EngineJobMessageSchema } from '@marketplace/contracts';
import { DispatchService } from './dispatch.service';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
  QUEUE_URL: process.env.QUEUE_URL!,
} as EnvConfig;

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: env.SQS_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

jest.setTimeout(60_000);

async function drain(predicate: (body: any) => boolean): Promise<any[]> {
  const found: any[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: env.QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
    );
    for (const m of out.Messages ?? []) {
      const body = JSON.parse(m.Body!);
      if (predicate(body)) found.push(body);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: env.QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }));
    }
    if (found.length > 0) break;
  }
  return found;
}

describe('DispatchService', () => {
  const service = new DispatchService(env);

  it('puts a contract-valid PROPOSE_FLOW message on the queue', async () => {
    const threadId = ulid();
    const field = `f_${Math.random().toString(36).slice(2, 8)}`;

    await service.dispatch({
      threadId,
      tenantId: 'tenant_disp',
      targetEntity: 'Event',
      payload: { addedFields: [{ name: field, type: 'string', required: false, default: null }] },
    });

    const [body] = await drain((b) => b?.payload?.addedFields?.[0]?.name === field);
    expect(body).toBeDefined();
    expect(() => EngineJobMessageSchema.parse(body)).not.toThrow();
    expect(body.tenantId).toBe('TENANT#tenant_disp');
    expect(body.metadata.threadId).toBe(threadId);
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
