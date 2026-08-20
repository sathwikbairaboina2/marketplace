import { CheckoutService } from './checkout.service';

const cart = { get: jest.fn(), clear: jest.fn() };
const orders = { create: jest.fn() };

const input = { currency: 'INR', shippingAddress: { line1: 'x' }, attributes: {} };

const line = (over: Record<string, unknown> = {}) => ({
  productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  qty: 2,
  name: 'Mug',
  unitPriceMinor: 1200,
  currency: 'INR',
  image: null,
  stock: 5,
  unavailable: false,
  ...over,
});

describe('CheckoutService', () => {
  const service = new CheckoutService(cart as never, orders as never);
  beforeEach(() => jest.clearAllMocks());

  it('refuses an empty cart and creates nothing', async () => {
    cart.get.mockResolvedValue({ lines: [], totalMinor: 0 });
    await expect(service.checkout(input)).rejects.toMatchObject({ status: 422 });
    expect(orders.create).not.toHaveBeenCalled();
    expect(cart.clear).not.toHaveBeenCalled();
  });

  it('refuses a cart holding an unavailable line, naming the product', async () => {
    cart.get.mockResolvedValue({
      lines: [line(), line({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FA0', unavailable: true, name: 'Gone' })],
      totalMinor: 2400,
    });
    await expect(service.checkout(input)).rejects.toMatchObject({
      problem: expect.objectContaining({ detail: expect.stringContaining('Gone') }),
    });
    expect(orders.create).not.toHaveBeenCalled();
  });

  it('creates the order awaiting payment from the cart lines and clears the cart', async () => {
    cart.get.mockResolvedValue({ lines: [line()], totalMinor: 2400 });
    orders.create.mockResolvedValue({ id: 'o1', status: 'awaiting_payment' });

    const order = await service.checkout(input);
    expect(order.id).toBe('o1');
    expect(orders.create).toHaveBeenCalledWith(
      {
        ...input,
        items: [{ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', quantity: 2 }],
      },
      { awaitPayment: true },
    );
    expect(cart.clear).toHaveBeenCalled();
  });

  it('still returns the order when the post-create clear fails', async () => {
    // If this throw propagated, the idempotency interceptor would release the
    // claim and a retry would double-order against the still-populated cart.
    cart.get.mockResolvedValue({ lines: [line()], totalMinor: 2400 });
    orders.create.mockResolvedValue({ id: 'o1', status: 'awaiting_payment' });
    cart.clear.mockRejectedValue(new Error('dynamo hiccup'));

    await expect(service.checkout(input)).resolves.toMatchObject({ id: 'o1' });
  });

  it('leaves the cart intact when order creation fails', async () => {
    cart.get.mockResolvedValue({ lines: [line()], totalMinor: 2400 });
    orders.create.mockRejectedValue(Object.assign(new Error('Insufficient stock'), { status: 409 }));

    await expect(service.checkout(input)).rejects.toMatchObject({ status: 409 });
    expect(cart.clear).not.toHaveBeenCalled();
  });
});
