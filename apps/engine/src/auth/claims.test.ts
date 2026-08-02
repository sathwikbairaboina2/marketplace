import { UnauthorizedException } from '@nestjs/common';
import { principalFromClaims } from './claims';

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
    expect(() => principalFromClaims({ sub: 'user-1' })).toThrow(UnauthorizedException);
  });

  it('rejects a token with no subject', () => {
    expect(() => principalFromClaims({ 'custom:tenant_id': 'client_123' })).toThrow(
      UnauthorizedException,
    );
  });
});
