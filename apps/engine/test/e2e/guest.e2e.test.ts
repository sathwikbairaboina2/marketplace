import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenant per run: the suite asserts on exact cart contents.
const TENANT = `tenant_guest_${Date.now()}`;
const OTHER = `tenant_guest_other_${Date.now()}`;
const api = `${baseUrl}/api/v1`;
const shop = (t: string) => `${api}/shops/${t}`;
const json = { 'content-type': 'application/json' };

async function createProduct(admin: Record<string, string>, over: Record<string, unknown> = {}) {
  const res = await fetch(`${api}/products`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({
      name: 'Mug',
      description: 'A stoneware mug',
      priceMinor: 1200,
      currency: 'USD',
      category: 'ceramics',
      stock: 10,
      status: 'active',
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

async function mint(t = TENANT): Promise<Record<string, string>> {
  const res = await fetch(`${shop(t)}/guest`, { method: 'POST' });
  expect(res.status).toBe(201);
  const { guest } = (await res.json()) as { guest: string };
  return { ...json, 'x-guest': guest };
}

const address = { currency: 'USD', shippingAddress: { line1: '42 Harbour Road' } };
const card = { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' };

describe('guest checkout', () => {
  let admin: Record<string, string>;
  let productId: string;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'guest-shop-admin@example.com');
    productId = (await createProduct(admin)).id;
  });

  it('hands a stranger a ticket, and refuses the cart without one', async () => {
    const res = await fetch(`${shop(TENANT)}/cart`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { type: string }).type).toContain('invalid-guest');
  });

  it('refuses a ticket minted for another shop', async () => {
    const other = await mint(OTHER);
    const res = await fetch(`${shop(TENANT)}/cart`, { headers: other });
    expect(res.status).toBe(401);
  });

  it('carts, checks out with an email, pays, and reads the order back', async () => {
    const guest = await mint();

    const put = await fetch(`${shop(TENANT)}/cart/lines/${productId}`, {
      method: 'PUT',
      headers: guest,
      body: JSON.stringify({ qty: 2 }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { totalMinor: number }).totalMinor).toBe(2400);

    const checkout = await fetch(`${shop(TENANT)}/checkout`, {
      method: 'POST',
      headers: { ...guest, 'idempotency-key': `guest-${Date.now()}` },
      body: JSON.stringify({ ...address, email: 'Stranger@Example.com' }),
    });
    expect(checkout.status).toBe(201);
    const order = (await checkout.json()) as { id: string; status: string; guestEmail: string; userId: string };
    expect(order.status).toBe('awaiting_payment');
    expect(order.guestEmail).toBe('stranger@example.com');
    expect(order.userId).toMatch(/^guest:/);

    // The cart is spent once the order exists.
    const after = await fetch(`${shop(TENANT)}/cart`, { headers: guest });
    expect(((await after.json()) as { lines: unknown[] }).lines).toEqual([]);

    const pay = await fetch(`${shop(TENANT)}/orders/${order.id}/pay`, {
      method: 'POST',
      headers: guest,
      body: JSON.stringify({ card }),
    });
    expect(pay.status).toBe(200);
    expect(((await pay.json()) as { status: string }).status).toBe('confirmed');

    const read = await fetch(`${shop(TENANT)}/orders/${order.id}`, { headers: guest });
    expect(read.status).toBe(200);

    // Another stranger's ticket sees nothing.
    const stranger = await mint();
    const hidden = await fetch(`${shop(TENANT)}/orders/${order.id}`, { headers: stranger });
    expect(hidden.status).toBe(404);

    // The seller sees it in the shop queue.
    const queue = await fetch(`${api}/orders/all?limit=50`, { headers: admin });
    expect(((await queue.json()) as { items: { id: string }[] }).items.some((o) => o.id === order.id)).toBe(true);

    // Lookup: right email finds it, wrong email and wrong id are the same 404.
    const found = await fetch(`${shop(TENANT)}/orders/lookup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ orderId: order.id, email: 'STRANGER@example.com' }),
    });
    expect(found.status).toBe(200);
    const wrongEmail = await fetch(`${shop(TENANT)}/orders/lookup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ orderId: order.id, email: 'someone-else@example.com' }),
    });
    expect(wrongEmail.status).toBe(404);
    const wrongId = await fetch(`${shop(TENANT)}/orders/lookup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ orderId: '01J000000000000000000000AB', email: 'stranger@example.com' }),
    });
    expect(wrongId.status).toBe(404);
    // Same problem type and title for both misses: the body must not say which.
    const [a, b] = (await Promise.all([wrongEmail.json(), wrongId.json()])) as { type: string; title: string }[];
    expect(a.type).toBe(b.type);
    expect(a.title).toBe(b.title);
  });

  it('lookup never finds a signed-in buyer order, whatever the email', async () => {
    const buyer = await authHeaders(TENANT, 'guest-shop-buyer@example.com', 'buyer');
    await fetch(`${api}/cart/lines/${productId}`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ qty: 1 }),
    });
    const checkout = await fetch(`${api}/checkout`, {
      method: 'POST',
      headers: { ...buyer, 'idempotency-key': `buyer-${Date.now()}` },
      body: JSON.stringify(address),
    });
    expect(checkout.status).toBe(201);
    const order = (await checkout.json()) as { id: string; guestEmail?: string };
    expect(order.guestEmail).toBeUndefined();

    const res = await fetch(`${shop(TENANT)}/orders/lookup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ orderId: order.id, email: 'guest-shop-buyer@example.com' }),
    });
    expect(res.status).toBe(404);
  });

  it('merges the guest cart into the account the stranger signs in to, and spends the ticket', async () => {
    const guest = await mint();
    const other = (await createProduct(admin, { name: 'Jug' })).id;
    await fetch(`${shop(TENANT)}/cart/lines/${productId}`, {
      method: 'PUT',
      headers: guest,
      body: JSON.stringify({ qty: 2 }),
    });
    await fetch(`${shop(TENANT)}/cart/lines/${other}`, {
      method: 'PUT',
      headers: guest,
      body: JSON.stringify({ qty: 1 }),
    });

    const buyer = await authHeaders(TENANT, `merge-${Date.now()}@example.com`, 'buyer');
    await fetch(`${api}/cart/lines/${productId}`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ qty: 1 }),
    });

    const merge = await fetch(`${api}/cart/merge`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify({ guest: guest['x-guest'] }),
    });
    expect(merge.status).toBe(200);
    const merged = (await merge.json()) as { lines: { productId: string; qty: number }[] };
    expect(merged.lines).toEqual([
      { productId, qty: 3 },
      { productId: other, qty: 1 },
    ].map((l) => expect.objectContaining(l)));

    const spent = await fetch(`${shop(TENANT)}/cart`, { headers: guest });
    expect(((await spent.json()) as { lines: unknown[] }).lines).toEqual([]);

    // A ticket from another shop cannot be merged into this one.
    const foreign = await mint(OTHER);
    const refused = await fetch(`${api}/cart/merge`, {
      method: 'POST',
      headers: buyer,
      body: JSON.stringify({ guest: foreign['x-guest'] }),
    });
    expect(refused.status).toBe(401);
  });
});
