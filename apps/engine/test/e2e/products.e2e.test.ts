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
    // Guard the destructure: if creation didn't actually succeed, `id` would be `undefined`
    // and the cross-tenant lookup below would 404 for the wrong reason (no such SK exists at
    // all), proving nothing about isolation. Asserting 201 first keeps the isolation claim
    // meaningful.
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // Positive half: the owning tenant can see it.
    const ownTenant = await fetch(`${baseUrl}/api/v1/products/${id}`, { headers: headersA });
    expect(ownTenant.status).toBe(200);

    // Negative half: a different tenant cannot, and gets 404 (never 403, never the record).
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

  it('finds a product by free text, case-insensitively', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...product, name: 'Walnut Serving Board', category: 'boards' }),
    });
    expect(created.status).toBe(201);

    const hit = await fetch(`${baseUrl}/api/v1/products/search`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ text: 'WALNUT serving' }),
    });
    expect(hit.status).toBe(200);
    const found = (await hit.json()) as { items: Array<{ name: string }> };
    expect(found.items.some((p) => p.name === 'Walnut Serving Board')).toBe(true);

    const miss = await fetch(`${baseUrl}/api/v1/products/search`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ text: 'zzz-no-such-thing' }),
    });
    const nothing = (await miss.json()) as { items: unknown[] };
    expect(nothing.items).toHaveLength(0);
  });

  it("refuses an image that is not this shop's media", async () => {
    // Another tenant's slice of the same bucket: the exact hotlink #05 exists
    // to stop. External hosts are refused by the same check.
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        ...product,
        images: ['http://localhost:34566/marketplace-media/tenant_b/products/x/y.png'],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { title: string };
    expect(body.title).toContain('media');
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

  it('rejects a non-numeric limit', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products?limit=abc`, { headers: headersA });
    expect(res.status).toBe(400);
  });

  it('paginates the list endpoint', async () => {
    // Seed at least two products for tenant A so pagination has something to page through,
    // independent of how many other tests in this file happened to run first.
    await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });
    await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });

    const page1Res = await fetch(`${baseUrl}/api/v1/products?limit=1`, { headers: headersA });
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(page1.items).toHaveLength(1);
    expect(page1.nextCursor).not.toBeNull();

    // Round-trip the cursor through the HTTP layer -- this exercises the controller's query
    // parsing, the service, and DynamoRepository's `ExclusiveStartKey` PK-pinning together,
    // not just the encode/decode unit tested in isolation.
    const page2Res = await fetch(
      `${baseUrl}/api/v1/products?limit=1&cursor=${encodeURIComponent(page1.nextCursor as string)}`,
      { headers: headersA },
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as { items: { id: string }[]; nextCursor: string | null };
    expect(page2.items).toHaveLength(1);

    // Don't assert exact ids -- other tests in this suite create products for tenant_a too, so
    // the only stable property is that page 2 doesn't repeat what page 1 already returned.
    const page1Ids = page1.items.map((i) => i.id);
    const page2Ids = page2.items.map((i) => i.id);
    expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false);
  });

  // A cursor is client-controlled input that ends up as DynamoDB's
  // ExclusiveStartKey. Anything that parsed as an object used to be forwarded
  // verbatim, and DynamoDB's `ValidationException` came back to the caller as
  // an unhandled 500. Asserted over HTTP because the 500 was produced by the
  // filter, not by the decoder.
  it.each([
    ['not base64 at all', 'not-a-cursor'],
    ['base64 JSON with no sort key', Buffer.from('{"PK":"TENANT#x"}').toString('base64url')],
    [
      'base64 JSON carrying a non-key attribute',
      Buffer.from('{"PK":"TENANT#x","SK":"PRODUCT#1","stock":5}').toString('base64url'),
    ],
    ['base64 of an empty object', Buffer.from('{}').toString('base64url')],
  ])('answers 400, never 500, for a cursor that is %s', async (_label, cursor) => {
    const res = await fetch(
      `${baseUrl}/api/v1/products?limit=5&cursor=${encodeURIComponent(cursor)}`,
      { headers: headersA },
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
