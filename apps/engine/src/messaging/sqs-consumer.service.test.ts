import { Message } from '@aws-sdk/client-sqs';
import { SqsConsumerService } from './sqs-consumer.service';
import { EnvConfig } from '../config/env.schema';
import { FlowsService, FlowResponse } from '../flows/flows.service';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { deriveIdFrom } from '../common/ids';

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
    GUEST_SECRET: 'a-fixture-secret-long-enough',
    LOG_LEVEL: 'info',
    SQS_CONSUMER_ENABLED: true,
    DOCS_ENABLED: false,
    CORS_ORIGINS: '',
    RATE_LIMIT: 600,
    RATE_LIMIT_WINDOW_MS: 60_000,
    MAX_IMAGE_BYTES: 5_242_880,
    IMAGE_GEN_CHECKPOINT: 'sd_xl_base_1.0.safetensors',
    IMAGE_GEN_TIMEOUT_MS: 120_000,
    DEV_TENANT_ID: 'tenant-dev',
    DEV_USERNAME: 'dev@marketplace.local',
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
    // The second argument is the Flow id deterministically derived from the message's own id
    // (`deriveIdFrom('msg-1')`), not a random one -- that determinism is what makes a redelivery
    // land on the same DynamoDB key via `putIfAbsent` instead of creating a second Flow row.
    expect(flows.propose).toHaveBeenCalledWith(
      {
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string', required: false, default: null }] },
      },
      deriveIdFrom('msg-1'),
    );
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

  it('leaves a schema-invalid message unacknowledged and never creates a Flow', async () => {
    const { flows, send, handle } = makeService('OK');

    await handle(makeMessage({ action: 'NOT_A_REAL_ACTION' }));

    expect(flows.propose).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a non-JSON message body unacknowledged and never creates a Flow', async () => {
    // Added specifically because the brief's own reference `handle()` calls `JSON.parse`
    // un-guarded and would throw synchronously on a body like this, aborting the rest of the
    // batch via poll()'s outer catch rather than handling this one message in isolation.
    const { flows, send, handle } = makeService('OK');

    await handle({ MessageId: 'msg-bad-json', ReceiptHandle: 'rh-bad-json', Body: '{ not valid json' });

    expect(flows.propose).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves a message with no MessageId unacknowledged rather than deriving a dedupe key or Flow id from "undefined"', async () => {
    const { flows, send, handle } = makeService('OK');

    await handle({
      ReceiptHandle: 'rh-no-id',
      Body: JSON.stringify({
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#client_123',
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      }),
    });

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

  // The Redis claim is only a fast-path optimisation, not the correctness guarantee: it cannot
  // distinguish "definitely not written" from "outcome unknown" (write committed, ack lost). This
  // simulates that ambiguous case directly -- the claim looks fresh/absent on *both* deliveries of
  // the same message (as it would after the failure-path release above, or a TTL/crash edge case)
  // -- and proves the real invariant is enforced one level down, by `FlowsService.propose`'s
  // deterministic id + `putIfAbsent`, not by Redis. Uses a real `FlowsService` over an in-memory
  // fake repository (rather than a mocked `FlowsService`) because that's the only way to observe
  // whether a second underlying DynamoDB row actually got created.
  it('produces exactly one Flow for two deliveries of the same message, even when the Redis claim is absent both times', async () => {
    const store = new Map<string, Record<string, unknown>>();
    const fakeRepo = {
      put: jest.fn(async (sk: string, item: Record<string, unknown>) => {
        store.set(sk, item);
      }),
      putIfAbsent: jest.fn(async (sk: string, item: Record<string, unknown>) => {
        if (store.has(sk)) return false;
        store.set(sk, item);
        return true;
      }),
      get: jest.fn(async (sk: string) => store.get(sk) ?? null),
    };
    const flows = new FlowsService(
      fakeRepo as unknown as DynamoRepository,
      {} as unknown as SchemaRegistryService, // unused by propose()/get()
    );
    // `redis.set` resolving 'OK' on every call simulates the claim looking absent/fresh each
    // time -- exactly the ambiguous case, not the ordinary "claim already held" redelivery path
    // covered by the test above.
    const redis = { set: jest.fn().mockResolvedValue('OK'), del: jest.fn().mockResolvedValue(1) };
    const service = new SqsConsumerService(makeEnv(), redis as never, flows);
    const send = jest.fn().mockResolvedValue({});
    (service as unknown as { sqs: { send: typeof send } }).sqs.send = send;
    const handle = (message: Message): Promise<void> =>
      (service as unknown as { handle: (m: Message) => Promise<void> }).handle(message);

    const message = makeMessage(
      {
        action: 'PROPOSE_FLOW',
        targetEntity: 'Product',
        tenantId: 'TENANT#client_123',
        payload: { addedFields: [{ name: 'x', type: 'string' }] },
        metadata: { threadId: 't1' },
      },
      'ambiguous-msg-1',
    );

    await handle(message);
    await handle(message); // redelivery of the exact same message

    expect(store.size).toBe(1); // exactly one Flow row, never two
    const [record] = [...store.values()] as FlowResponse[];
    expect(record.id).toBe(deriveIdFrom('ambiguous-msg-1'));
    expect(send).toHaveBeenCalledTimes(2); // both deliveries are acknowledged
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
