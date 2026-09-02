import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenants. Every status is created once here and the assertions are
// about which of them a stranger can reach, so a shared tenant's leftovers
// would make the expected lists wrong rather than merely longer.
const TENANT = `shop-public-${Date.now()}`;
const OTHER = `shop-other-${Date.now()}`;
const shop = (p: string) => `${baseUrl}/api/v1/shops/${TENANT}${p}`;

const product = (name: string, status: string) => ({
  name,
  description: 'public surface fixture',
  priceMinor: 1200,
  currency: 'USD',
  category: 'mugs',
  stock: 3,
  images: [],
  status,
  attributes: {},
});

describe('public shop surface', () => {
  let admin: Record<string, string>;
  let other: Record<string, string>;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, `${TENANT}-admin@example.com`, 'admin');
    other = await authHeaders(OTHER, `${OTHER}-admin@example.com`, 'admin');
    for (const status of ['active', 'out_of_stock', 'draft', 'archived']) {
      const res = await fetch(`${baseUrl}/api/v1/products`, {
        method: 'POST',
        headers: admin,
        body: JSON.stringify(product(`${status} mug`, status)),
      });
      expect(res.status).toBe(201);
      ids[status] = ((await res.json()) as { id: string }).id;
    }
    const foreign = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: other,
      body: JSON.stringify(product('foreign mug', 'active')),
    });
    expect(foreign.status).toBe(201);
    ids.foreign = ((await foreign.json()) as { id: string }).id;
  });

  const statusesOf = async (res: Response) =>
    ((await res.json()) as { items: { status: string }[] }).items.map((i) => i.status).sort();

  it('lists only what a shopper may see, with no token', async () => {
    const res = await fetch(shop('/products?limit=50'));
    expect(res.status).toBe(200);
    expect(await statusesOf(res)).toEqual(['active', 'out_of_stock']);
  });

  it('the admin still sees every status through the token route', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products?limit=50`, { headers: admin });
    expect(await statusesOf(res)).toEqual(['active', 'archived', 'draft', 'out_of_stock']);
  });

  it.each(['draft', 'archived'])('answers 404 for a %s product by id', async (status) => {
    const res = await fetch(shop(`/products/${ids[status]}`));
    expect(res.status).toBe(404);
  });

  it('serves a visible product by id without table keys', async () => {
    const res = await fetch(shop(`/products/${ids.active}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe('active mug');
    expect(body.PK).toBeUndefined();
    expect(body.search).toBeUndefined();
  });

  it('ignores a status a searcher asks for', async () => {
    const res = await fetch(shop('/products/search'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'draft', attributes: {}, limit: 50 }),
    });
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { items: { name: string }[] }).items.map((i) => i.name);
    expect(names).not.toContain('draft mug');
    expect(names).toContain('active mug');
  });

  it("does not reach another shop's product through this shop", async () => {
    const res = await fetch(shop(`/products/${ids.foreign}`));
    expect(res.status).toBe(404);
  });

  it('answers 404 for a malformed shop id', async () => {
    const res = await fetch(`${baseUrl}/api/v1/shops/${encodeURIComponent('a b')}/products`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe('https://marketplace.local/problems/not-found');
  });

  it('serves the announcement, the schemas and the events list', async () => {
    expect((await fetch(shop('/announcement'))).status).toBe(200);
    const schemas = await fetch(shop('/schemas'));
    expect(schemas.status).toBe(200);
    expect(((await schemas.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);
    expect((await fetch(shop('/events?limit=5'))).status).toBe(200);
  });

  it('serves the storefront config only once published, and never the draft', async () => {
    const before = await fetch(shop('/storefront'));
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ config: null });

    const config = {
      presetId: 'market',
      overrides: {},
      about: { title: 'About', sections: [{ heading: 'Us', body: 'Mugs.' }] },
      banners: [],
      businessProfile: { kind: 'shop', name: 'Mugs', tone: 'warm', audience: 'all' },
    };
    const draft = await fetch(`${baseUrl}/api/v1/storefront/draft`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify(config),
    });
    expect(draft.status).toBe(200);
    // Drafted but not yet published: still nothing public.
    expect(await (await fetch(shop('/storefront'))).json()).toEqual({ config: null });

    const publish = await fetch(`${baseUrl}/api/v1/storefront/publish`, {
      method: 'POST',
      headers: admin,
    });
    expect(publish.status).toBe(201);
    const after = (await (await fetch(shop('/storefront'))).json()) as {
      config: { presetId: string };
    };
    expect(after.config.presetId).toBe('market');

    expect((await fetch(shop('/storefront/draft'))).status).toBe(404);
  });
});
