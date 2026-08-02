import { DynamoRepository } from './dynamo.repository';
import { runWithTenant } from '../common/tenant-context';
import { entitySk, gsi1UserPk, skPrefix } from './keys';
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

  it('does not leak items across tenants via queryPrefix', async () => {
    const tA = `t_${uniq()}`;
    const tB = `t_${uniq()}`;
    await asTenant(tA, () => repo.put(entitySk('Product', 'X1'), { entityType: 'Product' }));
    const page = await asTenant(tB, () => repo.queryPrefix(skPrefix('Product')));
    expect(page.items).toHaveLength(0);
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

    const first = await asTenant(t, () =>
      repo.queryPrefix<{ id: string }>(skPrefix('Product'), { limit: 2 }),
    );
    expect(first.items.map((i) => i.id)).toEqual(['ID0', 'ID1']);
    expect(first.nextCursor).not.toBeNull();

    const second = await asTenant(t, () =>
      repo.queryPrefix<{ id: string }>(skPrefix('Product'), { limit: 2, cursor: first.nextCursor }),
    );
    expect(second.items.map((i) => i.id)).toEqual(['ID2', 'ID3']);
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

  it('applies a filter with no name aliases', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      await repo.put(entitySk('Product', 'PRICE1'), { entityType: 'Product', price: 20 });
      await repo.put(entitySk('Product', 'PRICE2'), { entityType: 'Product', price: 5 });
    });

    const page = await asTenant(t, () =>
      repo.queryPrefix<{ price: number }>(skPrefix('Product'), {
        filter: { expression: 'price > :p', values: { ':p': 10 } },
      }),
    );
    expect(page.items.map((i) => i.price)).toEqual([20]);
  });

  it('applies Limit before FilterExpression, so a filtered page can return zero items with a non-null cursor', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      await repo.put(entitySk('Product', 'AAA'), { entityType: 'Product', category: 'other' });
      await repo.put(entitySk('Product', 'ZZZ'), { entityType: 'Product', category: 'target' });
    });

    const page = await asTenant(t, () =>
      repo.queryPrefix<{ category: string }>(skPrefix('Product'), {
        limit: 1,
        filter: { expression: '#c = :c', names: { '#c': 'category' }, values: { ':c': 'target' } },
      }),
    );

    expect(page.items).toHaveLength(0);
    expect(page.nextCursor).not.toBeNull();
  });

  it('throws if a filter tries to redefine the tenant-scoped :pk placeholder', async () => {
    const t = `t_${uniq()}`;
    await expect(
      asTenant(t, () =>
        repo.queryPrefix(skPrefix('Product'), {
          filter: { expression: 'PK = :pk', values: { ':pk': 'TENANT#victim' } },
        }),
      ),
    ).rejects.toThrow(/:pk/);
  });

  it('throws if a filter tries to redefine the tenant-scoped :sk placeholder', async () => {
    const t = `t_${uniq()}`;
    await expect(
      asTenant(t, () =>
        repo.queryPrefix(skPrefix('Product'), {
          filter: { expression: 'SK = :sk', values: { ':sk': 'OTHER#' } },
        }),
      ),
    ).rejects.toThrow(/:sk/);
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

  it('refuses to write an item whose GSI1PK belongs to another tenant', async () => {
    const t = `t_${uniq()}`;
    await expect(
      asTenant(t, () =>
        repo.put(entitySk('Order', 'O9'), {
          entityType: 'Order',
          GSI1PK: gsi1UserPk('victim-tenant', 'u1'),
          GSI1SK: 'ORDER#2026-08-03T10:00:00.000Z#O9',
        }),
      ),
    ).rejects.toThrow(/GSI1PK/);
  });

  it('refuses putIfAbsent for an item whose GSI1PK belongs to another tenant', async () => {
    const t = `t_${uniq()}`;
    await expect(
      asTenant(t, () =>
        repo.putIfAbsent(entitySk('Flow', 'F9'), {
          entityType: 'Flow',
          GSI1PK: gsi1UserPk('victim-tenant', 'u1'),
        }),
      ),
    ).rejects.toThrow(/GSI1PK/);
  });

  it('a rejected foreign GSI1PK write never reaches the victim tenant index', async () => {
    const attacker = `t_${uniq()}`;
    const victim = `t_${uniq()}`;
    await expect(
      asTenant(attacker, () =>
        repo.put(entitySk('Order', 'O10'), {
          entityType: 'Order',
          GSI1PK: gsi1UserPk(victim, 'u1'),
          GSI1SK: 'ORDER#2026-08-03T10:00:00.000Z#O10',
        }),
      ),
    ).rejects.toThrow(/GSI1PK/);

    const page = await asTenant(victim, () => repo.queryUserIndex('u1', skPrefix('Order')));
    expect(page.items).toHaveLength(0);
  });

  it('transactWrite commits every item in the transaction', async () => {
    const t = `t_${uniq()}`;
    const sk1 = entitySk('Product', 'TX1');
    const sk2 = entitySk('Product', 'TX2');
    await asTenant(t, () =>
      repo.transactWrite([
        { Put: { TableName: undefined, Item: { ...repo.key(sk1), entityType: 'Product' } } },
        { Put: { TableName: undefined, Item: { ...repo.key(sk2), entityType: 'Product' } } },
      ]),
    );

    const [a, b] = await asTenant(t, () => Promise.all([repo.get(sk1), repo.get(sk2)]));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
  });

  it('throws before writing anything if a transaction item carries a foreign PK', async () => {
    const t = `t_${uniq()}`;
    const sk = entitySk('Product', 'TX3');
    await expect(
      asTenant(t, () =>
        repo.transactWrite([
          {
            Put: {
              TableName: undefined,
              Item: { PK: 'TENANT#someone-else', SK: sk, entityType: 'Product' },
            },
          },
        ]),
      ),
    ).rejects.toThrow(/does not belong to the current tenant/);

    const found = await asTenant(t, () => repo.get(sk));
    expect(found).toBeNull();
  });
});
