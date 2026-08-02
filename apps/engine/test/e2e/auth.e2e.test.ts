import { baseUrl, waitForHealthy } from './setup';
import { authHeaders, tokenFor } from './helpers/auth';

describe('authentication', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('rejects a request with no token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    expect(res.status).toBe(401);
    // TODO(Task 8): restore application/problem+json assertion once ProblemFilter lands
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
});
