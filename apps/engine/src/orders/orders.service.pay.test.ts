import { OrdersService } from './orders.service';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderPaymentService } from './order-payment.service';
import { OrderLifecycleService } from './order-lifecycle.service';

const repo = {
  get: jest.fn(),
  put: jest.fn(),
  transactWrite: jest.fn(),
  key: jest.fn((sk: string) => ({ PK: 'TENANT#acme', SK: sk })),
  tableName: 'table',
};
const registry = { validate: jest.fn() };
const pipeline = { get: jest.fn() };
const provider = { charge: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'buyer-1', role: 'buyer' })),
}));
import { currentPrincipal } from '../common/tenant-context';

const card = { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' };

const awaitingOrder = (over: Record<string, unknown> = {}) => ({
  PK: 'TENANT#acme',
  SK: 'ORDER#o1',
  GSI1PK: 'x',
  GSI1SK: 'y',
  entityType: 'Order',
  id: 'o1',
  userId: 'buyer-1',
  status: 'awaiting_payment',
  totalAmountMinor: 2400,
  currency: 'INR',
  items: [{ productId: 'p1', quantity: 2, unitPriceMinor: 1200 }],
  shippingAddress: {},
  createdAt: '2026-08-20T00:00:00.000Z',
  attributes: {},
  pipelineVersion: 1,
  stages: [
    { id: 's1', name: 'Packing', cancellable: true, messageable: false },
    { id: 's2', name: 'Shipped', cancellable: false, messageable: false },
  ],
  currentStageId: null,
  stageEnteredAt: '2026-08-20T00:00:00.000Z',
  ...over,
});

describe('OrdersService.pay', () => {
  const service = new OrdersService(
    repo as never,
    new OrderCheckoutService(repo as never, registry as never, pipeline as never),
    new OrderPaymentService(repo as never, provider as never),
    new OrderLifecycleService(repo as never),
  );
  beforeEach(() => jest.clearAllMocks());

  it('404s an order owned by someone else', async () => {
    repo.get.mockResolvedValue(awaitingOrder({ userId: 'someone-else' }));
    await expect(service.pay('o1', card)).rejects.toMatchObject({ status: 404 });
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it('refuses an order that is not awaiting payment', async () => {
    repo.get.mockResolvedValue(awaitingOrder({ status: 'confirmed', currentStageId: 's1' }));
    await expect(service.pay('o1', card)).rejects.toMatchObject({
      problem: expect.objectContaining({ type: expect.stringContaining('order-not-payable') }),
    });
    expect(provider.charge).not.toHaveBeenCalled();
  });

  it('charges the order total from the record, never a client amount', async () => {
    repo.get.mockResolvedValue(awaitingOrder());
    provider.charge.mockResolvedValue({ paymentId: 'fake_1', last4: '4242' });
    repo.transactWrite.mockResolvedValue(undefined);

    await service.pay('o1', card);
    expect(provider.charge).toHaveBeenCalledWith({
      orderId: 'o1',
      amountMinor: 2400,
      currency: 'INR',
      card,
    });
  });

  it('moves a paid order into stage 1 and records last4 only', async () => {
    repo.get.mockResolvedValue(awaitingOrder());
    provider.charge.mockResolvedValue({ paymentId: 'fake_1', last4: '4242' });
    repo.transactWrite.mockResolvedValue(undefined);

    const result = await service.pay('o1', card);
    expect(result.status).toBe('confirmed');
    expect(result.currentStageId).toBe('s1');
    expect(result.payment).toMatchObject({ id: 'fake_1', last4: '4242', amountMinor: 2400 });
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
  });

  it('propagates a declined charge without writing the order', async () => {
    repo.get.mockResolvedValue(awaitingOrder());
    provider.charge.mockRejectedValue(Object.assign(new Error('declined'), { status: 402 }));

    await expect(service.pay('o1', card)).rejects.toMatchObject({ status: 402 });
    expect(repo.transactWrite).not.toHaveBeenCalled();
  });

  it('reports order-not-payable when the conditional write loses the race', async () => {
    // Outcome, not error class: DynamoDB Local raises ConditionalCheckFailed
    // where a real table may raise TransactionConflict.
    repo.get.mockResolvedValue(awaitingOrder());
    provider.charge.mockResolvedValue({ paymentId: 'fake_1', last4: '4242' });
    repo.transactWrite.mockRejectedValue({
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
    });

    await expect(service.pay('o1', card)).rejects.toMatchObject({
      problem: expect.objectContaining({ type: expect.stringContaining('order-not-payable') }),
    });
  });
});

describe('OrdersService.cancel from the payment gate', () => {
  const service = new OrdersService(
    repo as never,
    new OrderCheckoutService(repo as never, registry as never, pipeline as never),
    new OrderPaymentService(repo as never, provider as never),
    new OrderLifecycleService(repo as never),
  );
  beforeEach(() => jest.clearAllMocks());

  it('lets the owner cancel an awaiting_payment order regardless of stage flags', async () => {
    repo.get.mockResolvedValue(
      awaitingOrder({
        stages: [{ id: 's1', name: 'Packing', cancellable: false, messageable: false }],
      }),
    );
    repo.transactWrite.mockResolvedValue(undefined);

    const result = await service.cancel('o1');
    expect(result.status).toBe('cancelled');
    // Stock restore items precede the order update, and the order condition is
    // status-only (an awaiting order has no stage to condition on).
    const items = repo.transactWrite.mock.calls[0][0];
    expect(items).toHaveLength(2);
    expect(items[1].Update.ConditionExpression).toBe('#status = :expected');
    expect(items[1].Update.ExpressionAttributeValues[':expected']).toBe('awaiting_payment');
  });

  it('lets a tenant admin cancel another user’s awaiting_payment order', async () => {
    (currentPrincipal as jest.Mock).mockReturnValue({
      tenantId: 'acme',
      userId: 'admin-1',
      role: 'admin',
    });
    repo.get.mockResolvedValue(awaitingOrder({ userId: 'buyer-1' }));
    repo.transactWrite.mockResolvedValue(undefined);

    await expect(service.cancel('o1')).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('says "paid", not "stage moved", when a cancel from the gate loses to a pay', async () => {
    repo.get
      .mockResolvedValueOnce(awaitingOrder())
      .mockResolvedValueOnce(awaitingOrder({ status: 'confirmed', currentStageId: 's1' }));
    repo.transactWrite.mockRejectedValue({
      // Index 1 = the order update (one line item ahead of it).
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    });

    await expect(service.cancel('o1')).rejects.toMatchObject({
      problem: expect.objectContaining({
        type: expect.stringContaining('order-not-cancellable'),
        detail: expect.stringContaining('paid'),
      }),
    });
  });

  it('still 404s an admin cancelling another user’s confirmed order', async () => {
    (currentPrincipal as jest.Mock).mockReturnValue({
      tenantId: 'acme',
      userId: 'admin-1',
      role: 'admin',
    });
    repo.get.mockResolvedValue(
      awaitingOrder({ userId: 'buyer-1', status: 'confirmed', currentStageId: 's1' }),
    );
    await expect(service.cancel('o1')).rejects.toMatchObject({ status: 404 });
  });
});
