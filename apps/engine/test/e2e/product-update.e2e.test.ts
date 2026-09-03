import { baseUrl, waitForHealthy } from './setup';
import { authHeaders, tokenFor } from './helpers/auth';

/**
 * Editing a product.
 *
 * Until this existed a shop could not correct a typo, change a price, restock,
 * or replace a photograph -- the only way to change anything was to create a
 * second product and leave the first one standing.
 */
describe('PATCH /products/:id', () => {
  const TENANT = 'tenant_update';
  let headers: Record<string, string>;

  const product = {
    name: 'Original name',
    description: 'original description',
    priceMinor: 1000,
    currency: 'USD',
    category: 'kitchen',
    stock: 5,
    images: [],
    status: 'active',
    attributes: {},
  };

  const create = async (over: Record<string, unknown> = {}) => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...product, ...over }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: string; updatedAt: string; createdAt: string };
  };

  const patch = (id: string, body: unknown, h = headers) =>
    fetch(`${baseUrl}/api/v1/products/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify(body) });

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders(TENANT, 'update-admin@example.com');
  });

  it('changes one field and leaves the rest alone', async () => {
    const created = await create();
    const res = await patch(created.id, { name: 'Corrected name' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('Corrected name');
    expect(body.description).toBe('original description');
    expect(body.priceMinor).toBe(1000);
    expect(body.stock).toBe(5);
  });

  it('persists the change for the next reader', async () => {
    const created = await create();
    await patch(created.id, { priceMinor: 2599 });

    const res = await fetch(`${baseUrl}/api/v1/products/${created.id}`, { headers });
    expect(((await res.json()) as { priceMinor: number }).priceMinor).toBe(2599);
  });

  it('moves updatedAt but never createdAt', async () => {
    const created = await create();
    await new Promise((r) => setTimeout(r, 5));
    const body = (await (await patch(created.id, { stock: 9 })).json()) as {
      createdAt: string;
      updatedAt: string;
    };

    expect(body.createdAt).toBe(created.createdAt);
    expect(Date.parse(body.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
  });

  it('restocks a sold-out product', async () => {
    const created = await create({ stock: 0, status: 'out_of_stock' });
    const body = (await (await patch(created.id, { stock: 12, status: 'active' })).json()) as {
      stock: number;
      status: string;
    };

    expect(body.stock).toBe(12);
    expect(body.status).toBe('active');
  });

  // The media policy (#05) only admits this shop's own bucket slice, so the
  // fixtures point there; the objects need not exist for a URL to be stored.
  const OWN = `http://localhost:34566/marketplace-media/${TENANT}/products`;

  it('replaces the photographs', async () => {
    const created = await create({ images: [`${OWN}/a/old.png`] });
    const body = (await (
      await patch(created.id, { images: [`${OWN}/b/new.png`] })
    ).json()) as { images: string[] };

    expect(body.images).toEqual([`${OWN}/b/new.png`]);
  });

  it("refuses a patch pointing at media that is not this shop's", async () => {
    const created = await create();
    const res = await patch(created.id, {
      images: ['http://localhost:34566/marketplace-media/tenant_other/products/x/y.png'],
    });
    expect(res.status).toBe(422);
  });

  it('withdraws a product by archiving it', async () => {
    const created = await create();
    expect((await patch(created.id, { status: 'archived' })).status).toBe(200);

    const res = await fetch(`${baseUrl}/api/v1/products/${created.id}`, { headers });
    expect(((await res.json()) as { status: string }).status).toBe('archived');
  });

  it('refuses an empty patch', async () => {
    const created = await create();
    expect((await patch(created.id, {})).status).toBe(400);
  });

  it('refuses a field that is not part of a product', async () => {
    const created = await create();
    expect((await patch(created.id, { sneaky: 'value' })).status).toBe(400);
  });

  it('refuses to let a caller set the identifier or the audit stamps', async () => {
    const created = await create();
    for (const body of [{ id: 'ANOTHER' }, { createdAt: '2020-01-01T00:00:00.000Z' }]) {
      expect((await patch(created.id, body)).status).toBe(400);
    }
  });

  it('applies the same bounds as creation', async () => {
    const created = await create();
    for (const body of [{ priceMinor: -1 }, { stock: -1 }, { name: '   ' }, { status: 'nearly' }]) {
      expect((await patch(created.id, body)).status).toBe(400);
    }
  });

  it('answers 404 for a product that does not exist', async () => {
    expect((await patch('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 1 })).status).toBe(404);
  });

  it("refuses to edit another tenant's product", async () => {
    const created = await create();
    const outsider = {
      authorization: `Bearer ${await tokenFor('tenant_update_other', 'outsider@example.com')}`,
      'content-type': 'application/json',
    };

    expect((await patch(created.id, { priceMinor: 1 }, outsider)).status).toBe(404);

    const res = await fetch(`${baseUrl}/api/v1/products/${created.id}`, { headers });
    expect(((await res.json()) as { priceMinor: number }).priceMinor).toBe(1000);
  });

  it('refuses a buyer', async () => {
    const created = await create();
    const buyer = {
      authorization: `Bearer ${await tokenFor(TENANT, 'update-buyer@example.com', 'buyer')}`,
      'content-type': 'application/json',
    };

    expect((await patch(created.id, { priceMinor: 1 }, buyer)).status).toBe(403);
  });

  it('validates tenant-defined attributes exactly as creation does', async () => {
    const created = await create();
    expect((await patch(created.id, { attributes: { neverDeclared: 'x' } })).status).toBe(422);
  });

  // An order locks its unit price at the moment it is placed, so repricing a
  // product afterwards must not rewrite what a buyer already agreed to pay.
  it('does not touch the price recorded on an existing order', async () => {
    const created = await create({ priceMinor: 500, stock: 5 });
    const order = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { ...headers, 'idempotency-key': `patch-price-${Date.now()}` },
      body: JSON.stringify({
        items: [{ productId: created.id, quantity: 1 }],
        currency: 'USD',
        shippingAddress: { line1: '1 Test St', city: 'Test', postcode: 'T1' },
        attributes: {},
      }),
    });
    const placed = (await order.json()) as { id: string };

    await patch(created.id, { priceMinor: 9999 });

    const res = await fetch(`${baseUrl}/api/v1/orders/${placed.id}`, { headers });
    const body = (await res.json()) as { items: { unitPriceMinor: number }[] };
    expect(body.items[0].unitPriceMinor).toBe(500);
  });
});
