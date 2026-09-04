import { AbandonedOrdersService } from './abandoned-orders.service';

const repo = { scanUnpaidOrders: jest.fn() };
const lifecycle = { cancel: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  runWithTenant: jest.fn((_principal: unknown, fn: () => unknown) => fn()),
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'system:sweeper', role: 'admin' })),
  currentTenantId: jest.fn(() => 'acme'),
}));
import { runWithTenant } from '../common/tenant-context';

const HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const JUST_NOW = new Date().toISOString();

const unpaid = (over: Record<string, unknown> = {}) => ({
  PK: 'TENANT#acme',
  SK: 'ORDER#o1',
  entityType: 'Order',
  id: 'o1',
  status: 'awaiting_payment',
  createdAt: HOUR_AGO,
  ...over,
});

describe('giving back the stock abandoned orders are holding', () => {
  const service = new AbandonedOrdersService(
    { SQS_CONSUMER_ENABLED: false } as never,
    repo as never,
    lifecycle as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lifecycle.cancel.mockResolvedValue(undefined);
  });

  it('cancels an order that has held stock for longer than the window', async () => {
    repo.scanUnpaidOrders.mockResolvedValue([unpaid()]);

    expect(await service.sweep()).toBe(1);
    expect(lifecycle.cancel).toHaveBeenCalledWith('o1');
  });

  // The window is the whole point: a shopper who is in their banking app right
  // now must not have the order cancelled underneath them.
  it('leaves a payment that is still in flight alone', async () => {
    repo.scanUnpaidOrders.mockResolvedValue([
      unpaid({ createdAt: JUST_NOW, status: 'payment_pending' }),
    ]);

    expect(await service.sweep()).toBe(0);
    expect(lifecycle.cancel).not.toHaveBeenCalled();
  });

  it('reclaims an old payment_pending order too, because UPI walks away', async () => {
    repo.scanUnpaidOrders.mockResolvedValue([unpaid({ status: 'payment_pending' })]);

    expect(await service.sweep()).toBe(1);
  });

  it('takes the tenant from the item, never from anywhere a caller could reach', async () => {
    repo.scanUnpaidOrders.mockResolvedValue([unpaid({ PK: 'TENANT#globex' })]);

    await service.sweep();

    expect(runWithTenant).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'globex' }),
      expect.any(Function),
    );
  });

  // Somebody paying between the read and the write is the condition doing its
  // job. It must not stop the rest of the sweep.
  it('keeps going when one order refuses to cancel', async () => {
    repo.scanUnpaidOrders.mockResolvedValue([unpaid(), unpaid({ id: 'o2', SK: 'ORDER#o2' })]);
    lifecycle.cancel.mockRejectedValueOnce(new Error('order-not-cancellable'));

    expect(await service.sweep()).toBe(1);
    expect(lifecycle.cancel).toHaveBeenCalledTimes(2);
  });

  it('reports nothing rather than throwing when the table cannot be read', async () => {
    repo.scanUnpaidOrders.mockRejectedValue(new Error('table is gone'));

    expect(await service.sweep()).toBe(0);
  });
});
