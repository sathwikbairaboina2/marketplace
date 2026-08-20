import { randomUUID } from 'node:crypto';
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenant: the assertions are exact counts over the whole shop.
const TENANT = `tenant_stats_${Date.now()}`;

const product = {
  name: 'Bowl',
  description: 'A stoneware bowl',
  priceMinor: 2000,
  currency: 'INR',
  category: 'ceramics',
  stock: 4,
  status: 'active',
};

const card = { card: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' } };

describe('seller statistics and batch listing', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;
  let productId: string;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'stats-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'stats-buyer@example.com', 'buyer');
  });

  it('creates a whole batch in one call', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products/batch`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({
        items: [
          product,
          { ...product, name: 'Plate', stock: 20 },
          { ...product, name: 'Cup', stock: 20 },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { items: Array<{ id: string; name: string }> };
    expect(body.items).toHaveLength(3);
    productId = body.items[0].id;

    const listed = await fetch(`${baseUrl}/api/v1/products?limit=100`, { headers: admin });
    const all = (await listed.json()) as { items: unknown[] };
    expect(all.items).toHaveLength(3);
  });

  it('refuses a batch from a buyer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products/batch`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify({ items: [product] }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects the whole batch when one row is invalid, creating nothing', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products/batch`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ items: [product, { ...product, name: '   ' }] }),
    });
    expect(res.status).toBe(400);

    const listed = await fetch(`${baseUrl}/api/v1/products?limit=100`, { headers: admin });
    const all = (await listed.json()) as { items: unknown[] };
    expect(all.items).toHaveLength(3);
  });

  it('keeps the dashboard admin-only', async () => {
    const res = await fetch(`${baseUrl}/api/v1/stats/sales`, { headers: buyer });
    expect(res.status).toBe(403);
  });

  it('aggregates orders, revenue, top products and low stock', async () => {
    // One paid order for two bowls: revenue 4000, stock 4 -> 2 (low).
    await fetch(`${baseUrl}/api/v1/cart/lines/${productId}`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ qty: 2 }),
    });
    const checkout = await fetch(`${baseUrl}/api/v1/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': randomUUID() },
      body: JSON.stringify({ currency: 'INR', shippingAddress: { line1: '1 Kiln Lane' } }),
    });
    expect(checkout.status).toBe(201);
    const orderId = ((await checkout.json()) as { id: string }).id;
    const paid = await fetch(`${baseUrl}/api/v1/orders/${orderId}/pay`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(card),
    });
    expect(paid.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/v1/stats/sales`, { headers: admin });
    expect(res.status).toBe(200);
    const stats = (await res.json()) as {
      orders: { total: number; confirmed: number };
      revenueMinorByCurrency: Record<string, number>;
      topProducts: Array<{ productId: string; units: number }>;
      lowStock: Array<{ id: string; stock: number }>;
      truncated: boolean;
    };
    expect(stats.orders.confirmed).toBe(1);
    expect(stats.revenueMinorByCurrency.INR).toBe(4000);
    expect(stats.topProducts[0]).toMatchObject({ productId, units: 2 });
    expect(stats.lowStock.some((p) => p.id === productId && p.stock === 2)).toBe(true);
    expect(stats.truncated).toBe(false);
  });
});
