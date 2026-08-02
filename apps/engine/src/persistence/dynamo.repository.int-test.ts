import { DynamoRepository } from './dynamo.repository';
import { runWithTenant } from '../common/tenant-context';
import { entitySk, skPrefix } from './keys';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: process.env.TABLE_NAME ?? 'MarketplaceEngine',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
} as EnvConfig;

const repo = new DynamoRepository(env);
const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);

const uniq = () => Math.random().toString(36).slice(2, 10);

describe('DynamoRepository', () => {
  it('round-trips an item within a tenant', async () => {
    const t = `t_${uniq()}`;
    const sk = entitySk('Product', 'ID1');
    await asTenant(t, () => repo.put(sk, { entityType: 'Product', id: 'ID1', name: 'Chair' }));
    const found = await asTenant(t, () => repo.get<{ name: string }>(sk));
    expect(found?.name).toBe('Chair');
  });

  it('does not leak items across tenants', async () => {
    const sk = entitySk('Product', 'ID2');
    await asTenant('tenant_a', () => repo.put(sk, { entityType: 'Product', id: 'ID2' }));
    const found = await asTenant('tenant_b', () => repo.get(sk));
    expect(found).toBeNull();
  });

  it('refuses to write with no tenant context', async () => {
    await expect(repo.put(entitySk('Product', 'ID3'), {})).rejects.toThrow(/no tenant context/);
  });

  it('paginates a prefix query and returns a resumable cursor', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      for (let i = 0; i < 5; i++) {
        await repo.put(entitySk('Product', `ID${i}`), { entityType: 'Product', id: `ID${i}` });
      }
    });

    const first = await asTenant(t, () => repo.queryPrefix(skPrefix('Product'), { limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await asTenant(t, () =>
      repo.queryPrefix(skPrefix('Product'), { limit: 2, cursor: first.nextCursor }),
    );
    expect(second.items).toHaveLength(2);
    expect(second.items).not.toEqual(first.items);
  });

  it('applies a filter expression', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      await repo.put(entitySk('Product', 'IDA'), { entityType: 'Product', category: 'chairs' });
      await repo.put(entitySk('Product', 'IDB'), { entityType: 'Product', category: 'desks' });
    });

    const page = await asTenant(t, () =>
      repo.queryPrefix<{ category: string }>(skPrefix('Product'), {
        filter: { expression: '#c = :c', names: { '#c': 'category' }, values: { ':c': 'chairs' } },
      }),
    );
    expect(page.items.map((i) => i.category)).toEqual(['chairs']);
  });

  it('putIfAbsent returns false on a second write', async () => {
    const t = `t_${uniq()}`;
    const sk = entitySk('Flow', 'F1');
    expect(await asTenant(t, () => repo.putIfAbsent(sk, { entityType: 'Flow' }))).toBe(true);
    expect(await asTenant(t, () => repo.putIfAbsent(sk, { entityType: 'Flow' }))).toBe(false);
  });

  it('queries the user index', async () => {
    const t = `t_${uniq()}`;
    await runWithTenant({ tenantId: t, userId: 'user-9', role: null }, async () => {
      await repo.put(entitySk('Order', 'O1'), {
        entityType: 'Order',
        GSI1PK: `TENANT#${t}#USER#user-9`,
        GSI1SK: 'ORDER#2026-08-03T10:00:00.000Z#O1',
      });
      const page = await repo.queryUserIndex('user-9', skPrefix('Order'));
      expect(page.items).toHaveLength(1);
    });
  });
});
