import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const product = {
  name: 'Chair',
  description: 'A comfy chair',
  priceMinor: 4999,
  currency: 'INR',
  category: 'chairs',
  stock: 10,
  status: 'active',
};

describe('products', () => {
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headersA = await authHeaders('tenant_a', 'alice@example.com');
    headersB = await authHeaders('tenant_b', 'bob@example.com');
  });

  it('creates and reads back a product', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; priceMinor: number };
    expect(body.priceMinor).toBe(4999);

    const fetched = await fetch(`${baseUrl}/api/v1/products/${body.id}`, { headers: headersA });
    expect(fetched.status).toBe(200);
  });

  it('does not expose one tenant product to another', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });
    const { id } = (await created.json()) as { id: string };

    const crossTenant = await fetch(`${baseUrl}/api/v1/products/${id}`, { headers: headersB });
    expect(crossTenant.status).toBe(404);
  });

  it('rejects an unknown dynamic attribute', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...product, attributes: { notDefined: 'x' } }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { type: string };
    expect(body.type).toContain('schema-validation-failed');
  });

  it('searches on a core field', async () => {
    await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...product, category: 'desks' }),
    });

    const res = await fetch(`${baseUrl}/api/v1/products/search`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ category: 'desks' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { category: string }[] };
    expect(body.items.every((i) => i.category === 'desks')).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('paginates the list endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products?limit=1`, { headers: headersA });
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});
