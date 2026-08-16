import { baseUrl, waitForHealthy } from './setup';
import { tokenFor } from './helpers/auth';

/**
 * The role boundary, end to end.
 *
 * Tenant isolation was enforced on every route and role on exactly one, so a
 * buyer's token -- or one minted before `custom:role` existed, carrying no role
 * at all -- could create products and events and execute a schema flow that
 * permanently alters the tenant's data model. Every assertion below failed
 * against the engine as it stood.
 */
describe('role enforcement', () => {
  const TENANT = 'tenant_roles';
  let admin: Record<string, string>;
  let buyer: Record<string, string>;
  let roleless: Record<string, string>;

  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  });

  const product = {
    name: 'role probe',
    description: 'probe',
    priceMinor: 1000,
    currency: 'USD',
    category: 'probe',
    stock: 5,
    images: [],
    status: 'active',
    attributes: {},
  };

  const event = {
    title: 'role probe event',
    capacity: 5,
    startDate: '2026-12-01T10:00:00.000Z',
    endDate: '2026-12-01T18:00:00.000Z',
    basePriceMinor: 100,
    currency: 'USD',
    attributes: {},
  };

  beforeAll(async () => {
    await waitForHealthy();
    admin = headers(await tokenFor(TENANT, 'roles-admin@example.com', 'admin'));
    buyer = headers(await tokenFor(TENANT, 'roles-buyer@example.com', 'buyer'));
    // Cognito accepts an empty custom attribute, which is the closest thing to
    // a token issued before the claim existed.
    roleless = headers(await tokenFor(TENANT, 'roles-none@example.com', ''));
  });

  it('lets an admin create a product', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify(product),
    });
    expect(res.status).toBe(201);
  });

  it('refuses a buyer creating a product', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(product),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('refuses a token carrying no role creating a product', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: roleless,
      body: JSON.stringify(product),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a buyer creating an event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a buyer proposing a schema flow', async () => {
    const res = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify({
        entityType: 'Product',
        addFields: { colour: { type: 'string', required: false } },
      }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a buyer executing a flow', async () => {
    const proposed = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({
        entityType: 'Product',
        addFields: { roleProbe: { type: 'string', required: false } },
      }),
    });
    const { id } = (await proposed.json()) as { id: string };

    const res = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, {
      method: 'POST',
      headers: buyer,
    });
    expect(res.status).toBe(403);
  });

  it('refuses a buyer uploading a product image', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), 'probe.png');

    const res = await fetch(`${baseUrl}/api/v1/uploads/product-image`, {
      method: 'POST',
      headers: { authorization: buyer.authorization },
      body: form,
    });
    expect(res.status).toBe(403);
  });

  it('refuses a buyer setting the announcement', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/announcement`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ text: 'buyer wrote this', enabled: true }),
    });
    expect(res.status).toBe(403);
  });

  // The buyer still has to be able to shop, which is the point of the split.
  it('lets a buyer read the catalogue and place an order', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ ...product, name: 'buyer can buy this' }),
    });
    const { id } = (await created.json()) as { id: string };

    const list = await fetch(`${baseUrl}/api/v1/products`, { headers: buyer });
    expect(list.status).toBe(200);

    const order = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': `roles-e2e-${Date.now()}` },
      body: JSON.stringify({
        items: [{ productId: id, quantity: 1 }],
        currency: 'USD',
        shippingAddress: { line1: '1 Test St', city: 'Test', postcode: 'T1' },
        attributes: {},
      }),
    });
    expect(order.status).toBe(201);
  });

  it('lets a buyer book a ticket', async () => {
    const created = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ ...event, title: 'buyer can book this' }),
    });
    const { id } = (await created.json()) as { id: string };

    const booking = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify({ eventId: id, ticketQuantity: 1, attributes: {} }),
    });
    expect(booking.status).toBe(201);
  });
});
