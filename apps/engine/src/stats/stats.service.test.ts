import { StatsService } from './stats.service';

const repo = { queryPrefix: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '../common/tenant-context';

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  status: 'confirmed',
  totalAmountMinor: 1000,
  currency: 'INR',
  items: [{ productId: 'p1', quantity: 2, unitPriceMinor: 500 }],
  ...over,
});

const product = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Mug',
  status: 'active',
  stock: 10,
  ...over,
});

/** repo.queryPrefix answers orders and products by prefix. */
const stock = (orders: unknown[], products: unknown[]) => {
  repo.queryPrefix.mockImplementation(async (prefix: string) => ({
    items: prefix.startsWith('ORDER') ? orders : products,
    nextCursor: null,
  }));
};

describe('StatsService.sales', () => {
  const service = new StatsService(repo as never);
  beforeEach(() => jest.clearAllMocks());

  it('refuses a non-admin in the service, not only on the route', async () => {
    (currentPrincipal as jest.Mock).mockReturnValueOnce({
      tenantId: 'acme',
      userId: 'u1',
      role: 'buyer',
    });
    await expect(service.sales()).rejects.toMatchObject({ status: 403 });
  });

  it('counts orders by status and takes revenue from confirmed orders only', async () => {
    stock(
      [
        order(),
        order({ id: 'o2', status: 'awaiting_payment' }),
        order({ id: 'o3', status: 'cancelled' }),
        order({ id: 'o4', totalAmountMinor: 500, items: [] }),
      ],
      [product()],
    );
    const stats = await service.sales();
    expect(stats.orders).toEqual({ total: 4, confirmed: 2, awaitingPayment: 1, cancelled: 1 });
    expect(stats.revenueMinorByCurrency).toEqual({ INR: 1500 });
  });

  it('keeps revenue per currency rather than summing across them', async () => {
    stock([order(), order({ id: 'o2', currency: 'USD', totalAmountMinor: 700 })], []);
    const stats = await service.sales();
    expect(stats.revenueMinorByCurrency).toEqual({ INR: 1000, USD: 700 });
  });

  it('ranks top products by units and names them from the catalogue', async () => {
    stock(
      [
        order({
          items: [
            { productId: 'p1', quantity: 1, unitPriceMinor: 500 },
            { productId: 'p2', quantity: 5, unitPriceMinor: 100 },
          ],
        }),
      ],
      [product(), product({ id: 'p2', name: 'Kettle' })],
    );
    const stats = await service.sales();
    expect(stats.topProducts[0]).toMatchObject({ productId: 'p2', name: 'Kettle', units: 5 });
    expect(stats.topProducts[1]).toMatchObject({ productId: 'p1', units: 1 });
  });

  it('splits one product sold in two currencies into two rows, never one sum', async () => {
    stock(
      [
        order({ items: [{ productId: 'p1', quantity: 2, unitPriceMinor: 500 }] }),
        order({
          id: 'o2',
          currency: 'JPY',
          totalAmountMinor: 700,
          items: [{ productId: 'p1', quantity: 1, unitPriceMinor: 700 }],
        }),
      ],
      [product()],
    );
    const stats = await service.sales();
    const p1Rows = stats.topProducts.filter((p) => p.productId === 'p1');
    expect(p1Rows).toHaveLength(2);
    expect(p1Rows.map((r) => r.currency).sort()).toEqual(['INR', 'JPY']);
    expect(p1Rows.find((r) => r.currency === 'INR')).toMatchObject({ revenueMinor: 1000 });
    expect(p1Rows.find((r) => r.currency === 'JPY')).toMatchObject({ revenueMinor: 700 });
  });

  it('names a product that left the catalogue as no longer listed', async () => {
    stock([order({ items: [{ productId: 'gone', quantity: 1, unitPriceMinor: 100 }] })], []);
    const stats = await service.sales();
    expect(stats.topProducts[0].name).toBe('(no longer listed)');
  });

  it('lists active products at or under the threshold, lowest first', async () => {
    stock(
      [],
      [
        product({ id: 'a', stock: 5 }),
        product({ id: 'b', stock: 0, name: 'Empty' }),
        product({ id: 'c', stock: 6 }),
        product({ id: 'd', stock: 1, status: 'archived' }),
      ],
    );
    const stats = await service.sales();
    expect(stats.lowStock.map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('reports truncation when the page budget stops a scan early', async () => {
    repo.queryPrefix.mockImplementation(async (prefix: string) => ({
      items: prefix.startsWith('ORDER') ? [order()] : [],
      // A cursor that never ends: the budget must stop the walk.
      nextCursor: 'more',
    }));
    const stats = await service.sales();
    expect(stats.truncated).toBe(true);
    expect(repo.queryPrefix.mock.calls.length).toBe(20); // 10 pages x 2 scans
  });
});
