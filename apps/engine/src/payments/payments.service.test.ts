import { PaymentsService } from './payments.service';
import { PaymentEvent } from './payment.provider';

const repo = {
  get: jest.fn(),
  put: jest.fn(),
  putIfAbsent: jest.fn(),
  transactWrite: jest.fn(),
  key: jest.fn((sk: string) => ({ PK: 'TENANT#acme', SK: sk })),
  tableName: 'table',
};
const provider = { createIntent: jest.fn(), getIntent: jest.fn(), verifyWebhook: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'guest:abc', role: 'guest' })),
  currentTenantId: jest.fn(() => 'acme'),
}));

const order = (over: Record<string, unknown> = {}) => ({
  PK: 'TENANT#acme',
  SK: 'ORDER#o1',
  entityType: 'Order',
  id: 'o1',
  reference: 'K7QY-3PX2',
  userId: 'guest:abc',
  status: 'awaiting_payment',
  totalAmountMinor: 420_000,
  balanceDueMinor: 0,
  currency: 'INR',
  items: [{ productId: 'p1', quantity: 1, unitPriceMinor: 420_000 }],
  shippingAddress: {},
  fulfilment: 'delivery',
  createdAt: '2026-09-04T00:00:00.000Z',
  attributes: {},
  pipelineVersion: 1,
  stages: [{ id: 's1', name: 'Packing', cancellable: true, messaging: false }],
  currentStageId: null,
  stageEnteredAt: '2026-09-04T00:00:00.000Z',
  ...over,
});

const intent = (over: Record<string, unknown> = {}) => ({
  entityType: 'PaymentIntent',
  intentId: 'upi_1',
  orderId: 'o1',
  tenantId: 'acme',
  amountMinor: 420_000,
  currency: 'INR',
  state: 'pending',
  createdAt: '2026-09-04T00:00:00.000Z',
  ...over,
});

const paidEvent = (over: Partial<PaymentEvent> = {}): PaymentEvent => ({
  eventId: 'evt_1',
  intentId: 'upi_1',
  tenantId: 'acme',
  state: 'paid',
  amountMinor: 420_000,
  paymentId: 'pay_1',
  ...over,
});

describe('starting a UPI payment', () => {
  const service = new PaymentsService(repo as never, provider as never);
  beforeEach(() => {
    jest.clearAllMocks();
    repo.put.mockResolvedValue(undefined);
    repo.transactWrite.mockResolvedValue(undefined);
    provider.createIntent.mockResolvedValue({ intentId: 'upi_1', state: 'pending' });
  });

  it('asks the gateway for the order amount, never the client', async () => {
    repo.get.mockResolvedValue(order());

    await service.start('o1', { method: 'upi' });

    expect(provider.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 420_000, currency: 'INR', tenantId: 'acme' }),
    );
  });

  it('collects only what is payable now when a deposit was taken', async () => {
    repo.get.mockResolvedValue(order({ balanceDueMinor: 210_000 }));

    await service.start('o1', { method: 'upi' });

    expect(provider.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 210_000 }),
    );
  });

  it('404s an order belonging to someone else, rather than 403', async () => {
    repo.get.mockResolvedValue(order({ userId: 'guest:someone-else' }));

    await expect(service.start('o1', { method: 'upi' })).rejects.toMatchObject({ status: 404 });
  });

  it('lets a guest prove the order with the email they checked out under', async () => {
    repo.get.mockResolvedValue(order({ userId: 'guest:other', guestEmail: 'her@example.com' }));

    await expect(
      service.start('o1', { method: 'upi' }, { guestEmail: 'HER@example.com' }),
    ).resolves.toMatchObject({ state: 'pending' });
  });

  it('refuses to start a second payment on an order already paid', async () => {
    repo.get.mockResolvedValue(order({ status: 'confirmed' }));

    await expect(service.start('o1', { method: 'upi' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('applying what the gateway says happened', () => {
  const service = new PaymentsService(repo as never, provider as never);
  beforeEach(() => {
    jest.clearAllMocks();
    repo.put.mockResolvedValue(undefined);
    repo.transactWrite.mockResolvedValue(undefined);
    repo.putIfAbsent.mockResolvedValue(true);
  });

  it('confirms the order and records what was taken', async () => {
    repo.get.mockResolvedValueOnce(intent()).mockResolvedValueOnce(order());

    await service.apply(paidEvent());

    const update = repo.transactWrite.mock.calls[0][0][0].Update;
    expect(update.ExpressionAttributeValues[':confirmed']).toBe('confirmed');
    expect(update.ExpressionAttributeValues[':payment'].amountMinor).toBe(420_000);
    // Conditioned, so a replay and a poll cannot both move the order.
    expect(update.ConditionExpression).toContain('#status');
  });

  // A gateway delivers at least once. The second delivery must be a no-op.
  it('does nothing at all the second time the same event arrives', async () => {
    repo.get.mockResolvedValue(intent());
    repo.putIfAbsent.mockResolvedValue(false);

    await service.apply(paidEvent());

    expect(repo.put).not.toHaveBeenCalled();
    expect(repo.transactWrite).not.toHaveBeenCalled();
  });

  // The order is the truth about what is owed; a message that disagrees is
  // refused rather than reconciled.
  it('refuses a payment for the wrong amount, and claims nothing', async () => {
    repo.get.mockResolvedValue(intent());

    await expect(service.apply(paidEvent({ amountMinor: 1 }))).rejects.toMatchObject({
      status: 409,
    });
    expect(repo.putIfAbsent).not.toHaveBeenCalled();
    expect(repo.transactWrite).not.toHaveBeenCalled();
  });

  it('refuses an event about an attempt this shop never started', async () => {
    repo.get.mockResolvedValue(null);

    await expect(service.apply(paidEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('leaves a confirmed order alone when a late event arrives', async () => {
    repo.get.mockResolvedValueOnce(intent()).mockResolvedValueOnce(order({ status: 'confirmed' }));

    await service.apply(paidEvent());

    expect(repo.transactWrite).not.toHaveBeenCalled();
  });

  it('puts the order back to payable when the customer declines', async () => {
    repo.get.mockResolvedValue(intent());

    await service.apply(paidEvent({ state: 'failed' }));

    const update = repo.transactWrite.mock.calls[0][0][0].Update;
    expect(update.ExpressionAttributeValues[':awaiting']).toBe('awaiting_payment');
  });
});

describe('asking what became of a payment', () => {
  const service = new PaymentsService(repo as never, provider as never);
  beforeEach(() => {
    jest.clearAllMocks();
    repo.put.mockResolvedValue(undefined);
    repo.transactWrite.mockResolvedValue(undefined);
    repo.putIfAbsent.mockResolvedValue(true);
  });

  // The whole reason the poll exists: a webhook that never arrived must not
  // leave a customer who paid looking at an order that says they did not.
  it('settles from the gateway when the webhook never came', async () => {
    // status() reads the intent, asks the gateway, applies the answer -- which
    // reads the intent again and then the order -- and re-reads the intent.
    repo.get
      .mockResolvedValueOnce(intent())
      .mockResolvedValueOnce(intent())
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce(intent({ state: 'paid' }));
    provider.getIntent.mockResolvedValue(paidEvent());

    const result = await service.status('upi_1');

    expect(provider.getIntent).toHaveBeenCalledWith('upi_1');
    // The order was actually confirmed, not merely reported as paid: without
    // this the case passes even when reconciliation does nothing.
    expect(repo.transactWrite).toHaveBeenCalled();
    expect(result.state).toBe('paid');
  });

  it('does not ask the gateway about a payment already settled here', async () => {
    repo.get.mockResolvedValue(intent({ state: 'paid' }));

    await service.status('upi_1');

    expect(provider.getIntent).not.toHaveBeenCalled();
  });

  it('stays pending, rather than failing, when the gateway cannot be reached', async () => {
    repo.get.mockResolvedValue(intent());
    provider.getIntent.mockRejectedValue(new Error('network'));

    await expect(service.status('upi_1')).resolves.toMatchObject({ state: 'pending' });
  });

  it('404s an intent nobody here started', async () => {
    repo.get.mockResolvedValue(null);

    await expect(service.status('upi_nope')).rejects.toMatchObject({ status: 404 });
  });
});
