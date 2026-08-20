import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

// Its own tenant, so publishing a storefront here cannot restyle any other
// suite's shop. Unique per run: unlike the suites that create fresh records
// each time, this one asserts on a *fresh tenant's* empty state, and the
// local table outlives the run.
const TENANT = `tenant_storefront_${Date.now()}`;

const config = {
  presetId: 'artisan',
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      cta: { label: 'Browse the shelf', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: {
    kind: 'ceramics studio',
    name: 'Kiln & Loom',
    tone: 'warm, personal',
    audience: 'gift shoppers',
  },
};

describe('storefront configuration', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'storefront-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'storefront-buyer@example.com', 'buyer');
  });

  it('keeps the draft admin-only', async () => {
    const read = await fetch(`${baseUrl}/api/v1/storefront/draft`, { headers: buyer });
    expect(read.status).toBe(403);

    const write = await fetch(`${baseUrl}/api/v1/storefront/draft`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify(config),
    });
    expect(write.status).toBe(403);
  });

  it('reports no draft and no image generation on a fresh tenant', async () => {
    const res = await fetch(`${baseUrl}/api/v1/storefront/draft`, { headers: admin });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ draft: null, capabilities: { imageGen: false } });
  });

  it('refuses to publish before any draft exists', async () => {
    const res = await fetch(`${baseUrl}/api/v1/storefront/publish`, {
      method: 'POST',
      headers: admin,
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { type: string };
    expect(body.type).toBe('https://marketplace.local/problems/storefront-draft-not-found');
  });

  it('rejects an accent white text cannot sit on', async () => {
    const res = await fetch(`${baseUrl}/api/v1/storefront/draft`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ ...config, overrides: { accent: '#ffe94a' } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ field: string }> };
    expect(body.errors.some((e) => e.field === 'overrides.accent')).toBe(true);
  });

  it('drafts, publishes, and serves the published config to any signed-in user', async () => {
    const draft = await fetch(`${baseUrl}/api/v1/storefront/draft`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify(config),
    });
    expect(draft.status).toBe(200);
    expect(await draft.json()).toEqual(config);

    const publish = await fetch(`${baseUrl}/api/v1/storefront/publish`, {
      method: 'POST',
      headers: admin,
    });
    expect(publish.status).toBe(201);

    const read = await fetch(`${baseUrl}/api/v1/storefront`, { headers: buyer });
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ config });
  });

  it('answers a fresh tenant with parseable JSON, not an empty body', async () => {
    const fresh = await authHeaders(`${TENANT}_untouched`, 'storefront-fresh@example.com', 'admin');
    const read = await fetch(`${baseUrl}/api/v1/storefront`, { headers: fresh });
    expect(read.status).toBe(200);
    // The regression this envelope exists for: a bare null serialized as a
    // zero-byte 200, and every JSON client on the other end threw.
    expect(await read.json()).toEqual({ config: null });
  });

  it('round-trips the onboarding dismissal flag', async () => {
    const before = await fetch(`${baseUrl}/api/v1/storefront/onboarding`, { headers: admin });
    expect(await before.json()).toEqual({ dismissed: false });

    const put = await fetch(`${baseUrl}/api/v1/storefront/onboarding`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ dismissed: true }),
    });
    expect(put.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/v1/storefront/onboarding`, { headers: buyer });
    expect(await after.json()).toEqual({ dismissed: true });
  });
});
