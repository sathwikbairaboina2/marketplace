import { AuthError } from './errors';
import { principalFromClaims } from './claims';
import { currentPrincipal, currentTenantId, runWithTenant } from './tenant-context';

describe('principalFromClaims', () => {
  it('maps cognito claims to a principal', () => {
    expect(
      principalFromClaims({ sub: 'user-1', 'custom:tenant_id': 'client_123', 'custom:role': 'admin' }),
    ).toEqual({ tenantId: 'client_123', userId: 'user-1', role: 'admin' });
  });

  it('defaults a missing role to null', () => {
    expect(principalFromClaims({ sub: 'user-1', 'custom:tenant_id': 'client_123' }).role).toBeNull();
  });

  it('rejects a token with no tenant claim', () => {
    expect(() => principalFromClaims({ sub: 'user-1' })).toThrow(AuthError);
  });

  it('rejects a token with no subject', () => {
    expect(() => principalFromClaims({ 'custom:tenant_id': 'client_123' })).toThrow(AuthError);
  });

  // These two cases mirror the pre-extraction apps/engine/src/auth/claims.test.ts. The
  // TENANT_ID_PATTERN check they cover isn't in the task-1 brief's claims.ts snippet, but it is
  // load-bearing in the current engine (see the comment in claims.ts) and must not regress.
  it('rejects a tenant claim containing a key-delimiter character', () => {
    expect(() => principalFromClaims({ sub: 'user-1', 'custom:tenant_id': 'client#123' })).toThrow(
      AuthError,
    );
  });

  it('rejects a whitespace-only tenant claim', () => {
    expect(() => principalFromClaims({ sub: 'user-1', 'custom:tenant_id': '   ' })).toThrow(AuthError);
  });
});

describe('tenant context', () => {
  it('exposes the principal inside a scope', () => {
    const principal = { tenantId: 'tenant_a', userId: 'user-1', role: null };
    const seen = runWithTenant(principal, () => ({
      principal: currentPrincipal(),
      tenantId: currentTenantId(),
    }));
    expect(seen).toEqual({ principal, tenantId: 'tenant_a' });
  });

  it('throws outside a scope', () => {
    expect(() => currentPrincipal()).toThrow(/no tenant context/);
  });
});
