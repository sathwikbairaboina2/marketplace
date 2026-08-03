import Redis from 'ioredis';
import { IdempotencyService } from './idempotency.service';
import { runWithTenant } from '../common/tenant-context';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const service = new IdempotencyService(redis);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);
const asUser = <T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId, role: null }, fn);
const uniq = () => Math.random().toString(36).slice(2, 10);

afterAll(async () => {
  await redis.quit();
});

describe('IdempotencyService', () => {
  it('claims a fresh key', async () => {
    expect(await asTenant('tenant_a', () => service.begin(uniq()))).toEqual({ status: 'new' });
  });

  it('reports a claimed but unfinished key as in progress', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await expect(asTenant('tenant_a', () => service.begin(key))).rejects.toThrow(/in progress/i);
  });

  it('replays a completed response', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await asTenant('tenant_a', () => service.complete(key, { id: 'ORDER-1' }));
    expect(await asTenant('tenant_a', () => service.begin(key))).toEqual({
      status: 'replay',
      response: { id: 'ORDER-1' },
    });
  });

  it('scopes keys per tenant', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    expect(await asTenant('tenant_b', () => service.begin(key))).toEqual({ status: 'new' });
  });

  it('scopes keys per user within the same tenant', async () => {
    // Idempotency-Key values are client-chosen, not generated here -- two different users in
    // the same tenant can easily pick the same string (an order id, a cart id, a retry
    // counter). Without per-user scoping, user B's request would find user A's completed key
    // and replay A's response verbatim: a cross-user data leak, and B's own request would never
    // run at all.
    const key = uniq();
    await asUser('tenant_a', 'user-a', () =>
      service.complete(key, { id: 'ORDER-A', owner: 'user-a' }),
    );

    // A fresh claim for the same key, same tenant, but a different user must be treated as an
    // unrelated request -- not a replay of user A's completed response.
    expect(await asUser('tenant_a', 'user-b', () => service.begin(key))).toEqual({
      status: 'new',
    });

    // And user A's own key is unaffected by user B's independent claim/completion cycle.
    await asUser('tenant_a', 'user-b', () => service.complete(key, { id: 'ORDER-B', owner: 'user-b' }));
    expect(await asUser('tenant_a', 'user-a', () => service.begin(key))).toEqual({
      status: 'replay',
      response: { id: 'ORDER-A', owner: 'user-a' },
    });
    expect(await asUser('tenant_a', 'user-b', () => service.begin(key))).toEqual({
      status: 'replay',
      response: { id: 'ORDER-B', owner: 'user-b' },
    });
  });

  it('frees a released key for retry', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await asTenant('tenant_a', () => service.release(key));
    expect(await asTenant('tenant_a', () => service.begin(key))).toEqual({ status: 'new' });
  });
});
