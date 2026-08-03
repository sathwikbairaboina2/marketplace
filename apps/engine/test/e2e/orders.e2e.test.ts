import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const productBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Chair',
  description: 'A chair',
  priceMinor: 1000,
  currency: 'INR',
  category: 'chairs',
  stock: 5,
  status: 'active',
  ...overrides,
});

async function createProduct(
  headers: Record<string, string>,
  overrides = {},
): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(productBody(overrides)),
  });
  // Every order test below builds on this product's id. If creation silently failed, an
  // unguarded destructure here would hand back `undefined` and every order test that follows
  // would fail (or worse, pass) for the wrong reason -- see the standing instruction on
  // guarding destructures with a status assertion.
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('orders', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('locks the unit price and decrements stock', async () => {
    const product = await createProduct(headers, { stock: 5, priceMinor: 1000 });

    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 2 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road', city: 'Bengaluru' },
      }),
    });
    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      totalAmountMinor: number;
      items: { unitPriceMinor: number }[];
    };
    expect(order.items[0].unitPriceMinor).toBe(1000);
    expect(order.totalAmountMinor).toBe(2000);

    const after = await fetch(`${baseUrl}/api/v1/products/${product.id}`, { headers });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { stock: number }).stock).toBe(3);
  });

  it('rejects an order for more stock than exists', async () => {
    const product = await createProduct(headers, { stock: 1 });
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 9 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { type: string; productId: string };
    expect(body.type).toContain('insufficient-stock');
    expect(body.productId).toBe(product.id);
  });

  it('rejects a mixed-currency order', async () => {
    const product = await createProduct(headers, { currency: 'INR' });
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 1 }],
        currency: 'USD',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { type: string }).type).toContain('mixed-currency-order');
  });

  it('rejects more than 50 line items', async () => {
    const product = await createProduct(headers);
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: Array.from({ length: 51 }, () => ({ productId: product.id, quantity: 1 })),
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { type: string }).type).toContain('too-many-line-items');
  });

  it('rejects the same product twice in one order', async () => {
    const product = await createProduct(headers);
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 1 },
        ],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('sells the last unit exactly once under concurrency', async () => {
    const product = await createProduct(headers, { stock: 1 });
    const body = JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      currency: 'INR',
      shippingAddress: { line1: '1 Road' },
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/api/v1/orders`, { method: 'POST', headers, body }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });

  it('replays an order for a repeated idempotency key', async () => {
    const product = await createProduct(headers, { stock: 5 });
    const key = `key-${Math.random().toString(36).slice(2)}`;
    const request = {
      method: 'POST',
      headers: { ...(headers as Record<string, string>), 'idempotency-key': key },
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 1 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    };

    const first = await fetch(`${baseUrl}/api/v1/orders`, request);
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { id: string };

    const second = await fetch(`${baseUrl}/api/v1/orders`, request);
    // A genuine replay still returns 201 (see IdempotencyInterceptor's doc comment: Nest fixes
    // the status per-route before the interceptor chain runs, so a replay keeps the original
    // request's status code) -- it is distinguished by the `Idempotent-Replayed` header, not by
    // a different status. Assert it explicitly so a regression that turns the second call into
    // an error doesn't hide behind an unguarded destructure below.
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { id: string };

    expect(secondBody.id).toBe(firstBody.id);

    const after = await fetch(`${baseUrl}/api/v1/products/${product.id}`, { headers });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { stock: number }).stock).toBe(4);
  });

  it('lists the caller own orders', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders?limit=5`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { items: unknown[] }).items)).toBe(true);
  });
});
