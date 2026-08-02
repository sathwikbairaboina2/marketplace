import { UnauthorizedException } from '@nestjs/common';
import { TenantPrincipal } from '../common/tenant-context';

export function principalFromClaims(claims: Record<string, unknown>): TenantPrincipal {
  const tenantId = claims['custom:tenant_id'];
  const userId = claims['sub'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new UnauthorizedException('token is missing the custom:tenant_id claim');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException('token is missing the sub claim');
  }
  const role = claims['custom:role'];
  return { tenantId, userId, role: typeof role === 'string' ? role : null };
}
