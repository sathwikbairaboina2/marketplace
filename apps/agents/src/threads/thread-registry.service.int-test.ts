import Redis from 'ioredis';
import { ulid } from 'ulid';
import { ThreadRegistryService } from './thread-registry.service';
import { EnvConfig } from '../config/env.schema';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { THREAD_TTL_SECONDS: 60 } as EnvConfig;
const registry = new ThreadRegistryService(env, redis);

const alice = { tenantId: 'tenant_a', userId: 'user-1', role: null };
const bob = { tenantId: 'tenant_b', userId: 'user-2', role: null };

afterAll(async () => {
  await redis.quit();
});

describe('ThreadRegistryService', () => {
  it('creates a ULID thread owned by the caller', async () => {
    const threadId = await registry.create(alice);
    expect(threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    await expect(registry.assertOwned(threadId, alice)).resolves.toBeUndefined();
  });

  it('hides a thread from another tenant', async () => {
    const threadId = await registry.create(alice);
    await expect(registry.assertOwned(threadId, bob)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('hides a thread that does not exist', async () => {
    await expect(registry.assertOwned(ulid(), alice)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('allows another user in the same tenant', async () => {
    const threadId = await registry.create(alice);
    const colleague = { tenantId: 'tenant_a', userId: 'user-9', role: null };
    await expect(registry.assertOwned(threadId, colleague)).resolves.toBeUndefined();
  });

  it('refreshes the expiry on touch', async () => {
    const threadId = await registry.create(alice);
    await redis.expire(`thread:${threadId}`, 5);
    await registry.touch(threadId);
    expect(await redis.ttl(`thread:${threadId}`)).toBeGreaterThan(5);
  });
});
