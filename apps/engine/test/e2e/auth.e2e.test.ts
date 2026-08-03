import { baseUrl, waitForHealthy } from './setup';
import { authHeaders, tokenFor } from './helpers/auth';

describe('authentication', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('rejects a request with no token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('rejects a malformed token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('resolves the tenant from the token claim', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: await authHeaders('tenant_a', 'alice@example.com'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: 'tenant_a' });
  });

  it('stamps each tenant claim onto its own token', async () => {
    const decodeClaims = (token: string): Record<string, unknown> =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

    const a = decodeClaims(await tokenFor('tenant_a', 'alice@example.com'));
    const b = decodeClaims(await tokenFor('tenant_b', 'bob@example.com'));

    expect(a['custom:tenant_id']).toBe('tenant_a');
    expect(b['custom:tenant_id']).toBe('tenant_b');
  });

  it('never leaks one tenant into a concurrent request for another', async () => {
    const tokenA = await tokenFor('tenant_concurrent_a', 'concurrent-a@example.com');
    const tokenB = await tokenFor('tenant_concurrent_b', 'concurrent-b@example.com');

    const requests = Array.from({ length: 24 }, (_, i) => {
      const [token, tenantId] = i % 2 === 0 ? [tokenA, 'tenant_concurrent_a'] : [tokenB, 'tenant_concurrent_b'];
      return fetch(`${baseUrl}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } })
        .then((res) => res.json())
        .then((body) => ({ expected: tenantId, got: (body as { tenantId: string }).tenantId }));
    });

    const results = await Promise.all(requests);
    for (const { expected, got } of results) {
      expect(got).toBe(expected);
    }
  });
});
