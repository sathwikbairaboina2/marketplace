import Redis from 'ioredis';
import { IdempotencyService } from './idempotency.service';
import { runWithTenant } from '../common/tenant-context';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const service = new IdempotencyService(redis);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);
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

  it('frees a released key for retry', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await asTenant('tenant_a', () => service.release(key));
    expect(await asTenant('tenant_a', () => service.begin(key))).toEqual({ status: 'new' });
  });
});
