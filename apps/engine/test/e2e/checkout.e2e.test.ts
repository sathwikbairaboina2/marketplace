import { randomUUID } from 'node:crypto';
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenant, unique per run: the suite asserts exact stock numbers.
const TENANT = `tenant_checkout_${Date.now()}`;

const product = {
  name: 'Vase',
  description: 'A stoneware vase',
  priceMinor: 3000,
  currency: 'INR',
  category: 'ceramics',
  stock: 5,
  status: 'active',
};

const CHECKOUT_BODY = { currency: 'INR', shippingAddress: { line1: '1 Kiln Lane' } };
const card = (number: string) => ({ card: { number, expMonth: 12, expYear: 2030, cvc: '123' } });

describe('checkout and payment', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;
  let productId: string;
  let orderId: string;

  async function stockNow(): Promise<number> {
    const res = await fetch(`${baseUrl}/api/v1/products/${productId}`, { headers: admin });
    return ((await res.json()) as { stock: number }).stock;
  }

  async function orderNow(): Promise<{ status: string; currentStageId: string | null }> {
    const res = await fetch(`${baseUrl}/api/v1/orders/${orderId}`, { headers: buyer });
    return (await res.json()) as { status: string; currentStageId: string | null };
  }

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'checkout-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'checkout-buyer@example.com', 'buyer');

    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify(product),
    });
    expect(created.status).toBe(201);
    productId = ((await created.json()) as { id: string }).id;
  });

  it('refuses an empty-cart checkout', async () => {
    const res = await fetch(`${baseUrl}/api/v1/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': randomUUID() },
      body: JSON.stringify(CHECKOUT_BODY),
    });
    expect(res.status).toBe(422);
  });

  it('creates an awaiting_payment order from the cart, reserves stock, empties the cart', async () => {
    await fetch(`${baseUrl}/api/v1/cart/lines/${productId}`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ qty: 2 }),
    });

    const key = randomUUID();
    const res = await fetch(`${baseUrl}/api/v1/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': key },
      body: JSON.stringify(CHECKOUT_BODY),
    });
    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      id: string;
      status: string;
      currentStageId: string | null;
      totalAmountMinor: number;
    };
    orderId = order.id;
    expect(order.status).toBe('awaiting_payment');
    expect(order.currentStageId).toBeNull();
    expect(order.totalAmountMinor).toBe(6000);

    expect(await stockNow()).toBe(3);

    const cart = await fetch(`${baseUrl}/api/v1/cart`, { headers: buyer });
    expect(await cart.json()).toEqual({ lines: [], totalMinor: 0 });

    // The same idempotency key replays the same order, creating nothing new.
    const replay = await fetch(`${baseUrl}/api/v1/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': key },
      body: JSON.stringify(CHECKOUT_BODY),
    });
    expect(((await replay.json()) as { id: string }).id).toBe(orderId);
    expect(await stockNow()).toBe(3);
  });

  it('refuses to advance an unpaid order', async () => {
    const order = await orderNow();
    const res = await fetch(`${baseUrl}/api/v1/orders/${orderId}/advance`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ currentStageId: order.currentStageId ?? 'none' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { type: string }).type).toContain('order-not-advanceable');
  });

  it('leaves a declined order awaiting payment', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders/${orderId}/pay`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(card('4000000000000002')),
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { type: string }).type).toContain('payment-declined');
    expect((await orderNow()).status).toBe('awaiting_payment');
  });

  it('confirms the order into stage 1 on a successful retry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders/${orderId}/pay`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(card('4242424242424242')),
    });
    expect(res.status).toBe(200);
    const order = (await res.json()) as {
      status: string;
      currentStageId: string | null;
      stages: Array<{ id: string }>;
      payment?: { last4: string; amountMinor: number };
    };
    expect(order.status).toBe('confirmed');
    expect(order.currentStageId).toBe(order.stages[0].id);
    expect(order.payment).toMatchObject({ last4: '4242', amountMinor: 6000 });
  });

  it('refuses a double pay', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders/${orderId}/pay`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(card('4242424242424242')),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { type: string }).type).toContain('order-not-payable');
  });

  it('restores stock when an unpaid order is abandoned', async () => {
    await fetch(`${baseUrl}/api/v1/cart/lines/${productId}`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ qty: 1 }),
    });
    const checkout = await fetch(`${baseUrl}/api/v1/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': randomUUID() },
      body: JSON.stringify(CHECKOUT_BODY),
    });
    expect(checkout.status).toBe(201);
    const abandoned = ((await checkout.json()) as { id: string }).id;
    expect(await stockNow()).toBe(2);

    const cancel = await fetch(`${baseUrl}/api/v1/orders/${abandoned}/cancel`, {
      method: 'POST',
      headers: buyer,
    });
    expect(cancel.status).toBe(200);
    expect(((await cancel.json()) as { status: string }).status).toBe('cancelled');
    expect(await stockNow()).toBe(3);
  });
});
