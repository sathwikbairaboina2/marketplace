import { Message } from '@aws-sdk/client-sqs';
import { SqsConsumerService } from './sqs-consumer.service';
import { EnvConfig } from '../config/env.schema';
import { FlowsService } from '../flows/flows.service';

// `handle()` is the security chokepoint the task brief calls out explicitly: unlike every other
// entry point, a tenant id arriving via SQS has never passed through a verified JWT claim. These
// tests exercise it directly (bypassing the real poll loop and a real SQS/Redis connection)
// because the guarantee under test -- "a malformed tenant id can never create a Flow" -- is a
// negative one that an e2e test cannot observe: there is no way to authenticate as a tenant whose
// id was rejected specifically because it is malformed, so `flows.propose` never being called is
// the only thing that can actually be asserted.

function makeEnv(overrides: Partial<EnvConfig> = {}): EnvConfig {
  return {
    PORT: 3000,
    AWS_REGION: 'us-east-1',
    TABLE_NAME: 'MarketplaceEngine',
    QUEUE_URL: 'http://localhost:4566/000000000000/marketplace-engine-jobs.fifo',
    REDIS_URL: 'redis://localhost:6379',
    JWKS_URI: 'http://localhost:9229/.well-known/jwks.json',
    JWT_ISSUER: 'http://localhost:9229/pool',
    JWT_AUDIENCE: 'client',
    LOG_LEVEL: 'info',
    SQS_CONSUMER_ENABLED: true,
    ...overrides,
  };
}

function makeMessage(body: unknown, messageId = 'msg-1'): Message {
  return { MessageId: messageId, ReceiptHandle: `rh-${messageId}`, Body: JSON.stringify(body) };
}

function makeService(redisSetResult: string | null) {
  const redis = { set: jest.fn().mockResolvedValue(redisSetResult), del: jest.fn().mockResolvedValue(1) };
  const flows = { propose: jest.fn().mockResolvedValue({ id: 'flow-1', status: 'proposed' }) };
  const service = new SqsConsumerService(makeEnv(), redis as never, flows as unknown as FlowsService);
  const send = jest.fn().mockResolvedValue({});
  // Replace the real SQSClient's send with a spy so `handle()` never makes a network call.
  (service as unknown as { sqs: { send: typeof send } }).sqs.send = send;
  const handle = (message: Message): Promise<void> =>
    (service as unknown as { handle: (m: Message) => Promise<void> }).handle(message);
  return { service, redis, flows, send, handle };
}

describe('SqsConsumerService.handle', () => {
  it('rejects a message whose (normalised) tenant id fails the auth-chokepoint pattern, and never creates a Flow', async () => {
    const { flows, redis, send, handle } = makeService('OK');

    await handle(
      makeMessage({
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#client/123', // '/' is a key-confusion character, must be rejected
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      }),
    );

    expect(flows.propose).not.toHaveBeenCalled();
    // Neither claimed for dedupe nor deleted from the queue: left unacknowledged so the
    // redrive policy moves it to the DLQ for forensics, per the task's chosen tradeoff.
    expect(redis.set).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a message with a `#`-containing tenant id even after TENANT# is stripped', async () => {
    const { flows, send, handle } = makeService('OK');

    await handle(
      makeMessage({
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#tenant#evil',
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      }),
    );

    expect(flows.propose).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('proposes a Flow under the normalised tenant id for a valid message and acknowledges it', async () => {
    const { flows, send, handle } = makeService('OK');

    await handle(
      makeMessage({
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#client_123',
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      }),
    );

    expect(flows.propose).toHaveBeenCalledTimes(1);
    // Zod fills in AddedFieldSchema's defaults (`required: false`, `default: null`) during parse.
    expect(flows.propose).toHaveBeenCalledWith({
      targetEntity: 'Product',
      actionType: 'ADD_FIELDS',
      blueprintDiff: { addedFields: [{ name: 'x', type: 'string', required: false, default: null }] },
    });
    expect(send).toHaveBeenCalledTimes(1); // DeleteMessageCommand
  });

  it('does not create a second Flow when the dedupe claim is already held (redelivery), but still acknowledges', async () => {
    const { flows, send, handle } = makeService(null); // redis.set NX returns null: already claimed

    await handle(
      makeMessage({
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#client_123',
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      }),
    );

    expect(flows.propose).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1); // still deleted: this delivery was already handled once
  });

  it('leaves an unparseable message unacknowledged and never creates a Flow', async () => {
    const { flows, send, handle } = makeService('OK');

    await handle(makeMessage({ action: 'NOT_A_REAL_ACTION' }));

    expect(flows.propose).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('releases the dedupe claim and rethrows if Flow creation fails, so a genuine retry is not silently swallowed', async () => {
    const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
    const flows = { propose: jest.fn().mockRejectedValue(new Error('dynamo blip')) };
    const service = new SqsConsumerService(makeEnv(), redis as never, flows as unknown as FlowsService);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqs: { send: typeof send } }).sqs.send = send;
    const handle = (message: Message): Promise<void> =>
      (service as unknown as { handle: (m: Message) => Promise<void> }).handle(message);

    await expect(
      handle(
        makeMessage({
          action: 'PROPOSE_FLOW',
          targetEntity: 'Product',
          tenantId: 'TENANT#client_123',
          payload: { addedFields: [{ name: 'x', type: 'string' }] },
          metadata: { threadId: 't1' },
        }),
      ),
    ).rejects.toThrow('dynamo blip');

    expect(redis.del).toHaveBeenCalledWith('sqsmsg:msg-1');
    expect(send).not.toHaveBeenCalled(); // not deleted: message must be retried
  });
});

// These exercise the actual poll loop (onModuleInit/onModuleDestroy), not `handle()` directly.
// A hang here (the loop never noticing `running` flipped to false) would make this test time out
// against jest's default per-test timeout rather than fail with an assertion -- which is exactly
// the failure mode "must stop on module destroy without leaving the process hanging" describes.
describe('SqsConsumerService lifecycle', () => {
  it('polls while enabled and onModuleDestroy resolves promptly, closing the SQS client', async () => {
    const redis = { set: jest.fn(), del: jest.fn() };
    const flows = { propose: jest.fn() };
    const service = new SqsConsumerService(
      makeEnv({ SQS_CONSUMER_ENABLED: true }),
      redis as never,
      flows as unknown as FlowsService,
    );
    const send = jest.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ Messages: [] }), 10)),
    );
    const destroy = jest.fn();
    const sqs = (service as unknown as { sqs: { send: typeof send; destroy: typeof destroy } }).sqs;
    sqs.send = send;
    sqs.destroy = destroy;

    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 30)); // let at least one poll iteration run

    await service.onModuleDestroy();

    expect(send).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('never polls when SQS_CONSUMER_ENABLED is false', async () => {
    const redis = { set: jest.fn(), del: jest.fn() };
    const flows = { propose: jest.fn() };
    const service = new SqsConsumerService(
      makeEnv({ SQS_CONSUMER_ENABLED: false }),
      redis as never,
      flows as unknown as FlowsService,
    );
    const send = jest.fn();
    (service as unknown as { sqs: { send: typeof send } }).sqs.send = send;

    service.onModuleInit();
    await new Promise((r) => setTimeout(r, 20));
    await service.onModuleDestroy();

    expect(send).not.toHaveBeenCalled();
  });
});
