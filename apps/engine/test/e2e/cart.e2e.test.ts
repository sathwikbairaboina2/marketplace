import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenant, unique per run: the suite asserts on empty carts and exact
// line contents, and the local table outlives the run.
const TENANT = `tenant_cart_${Date.now()}`;

const product = {
  name: 'Mug',
  description: 'A stoneware mug',
  priceMinor: 1200,
  currency: 'INR',
  category: 'ceramics',
  stock: 10,
  status: 'active',
};

async function createProduct(headers: Record<string, string>, over: Record<string, unknown> = {}) {
  const res = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...product, ...over }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; priceMinor: number };
}

describe('cart', () => {
  let admin: Record<string, string>;
  let buyerA: Record<string, string>;
  let buyerB: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'cart-admin@example.com', 'admin');
    buyerA = await authHeaders(TENANT, 'cart-buyer-a@example.com', 'buyer');
    buyerB = await authHeaders(TENANT, 'cart-buyer-b@example.com', 'buyer');
  });

  it('answers a fresh buyer with an empty cart', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cart`, { headers: buyerA });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: [], totalMinor: 0 });
  });

  it('puts a line and returns it resolved against the live product', async () => {
    const { id } = await createProduct(admin);
    const res = await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 2 }),
    });
    expect(res.status).toBe(200);
    const cart = (await res.json()) as {
      lines: Array<{ productId: string; qty: number; name: string; unitPriceMinor: number }>;
      totalMinor: number;
    };
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({
      productId: id,
      qty: 2,
      name: 'Mug',
      unitPriceMinor: 1200,
      unavailable: false,
    });
    expect(cart.totalMinor).toBe(2400);
  });

  it('replaces the quantity for a product already in the cart', async () => {
    const { id } = await createProduct(admin);
    await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 2 }),
    });
    const res = await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 5 }),
    });
    const cart = (await res.json()) as { lines: Array<{ productId: string; qty: number }> };
    expect(cart.lines.find((l) => l.productId === id)?.qty).toBe(5);
  });

  it('removes a line with qty 0', async () => {
    const { id } = await createProduct(admin);
    await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 1 }),
    });
    const res = await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 0 }),
    });
    const cart = (await res.json()) as { lines: Array<{ productId: string }> };
    expect(cart.lines.some((l) => l.productId === id)).toBe(false);
  });

  it('404s a line for a product that does not exist', async () => {
    const res = await fetch(`${baseUrl}/api/v1/cart/lines/01ARZ3NDEKTSV4RRFFQ69G5FAV`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 1 }),
    });
    expect(res.status).toBe(404);
  });

  it('keeps carts private between users of the same tenant', async () => {
    const { id } = await createProduct(admin);
    await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 3 }),
    });
    const res = await fetch(`${baseUrl}/api/v1/cart`, { headers: buyerB });
    const cart = (await res.json()) as { lines: Array<{ productId: string }> };
    expect(cart.lines.some((l) => l.productId === id)).toBe(false);
  });

  it('clears the cart', async () => {
    const { id } = await createProduct(admin);
    await fetch(`${baseUrl}/api/v1/cart/lines/${id}`, {
      method: 'PUT',
      headers: buyerA,
      body: JSON.stringify({ qty: 1 }),
    });
    const res = await fetch(`${baseUrl}/api/v1/cart`, { method: 'DELETE', headers: buyerA });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lines: [], totalMinor: 0 });
  });
});
