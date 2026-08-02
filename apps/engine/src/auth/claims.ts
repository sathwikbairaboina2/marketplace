import { UnauthorizedException } from '@nestjs/common';
import { TenantPrincipal } from '../common/tenant-context';

// Later tasks embed tenantId directly in single-table composite keys such as
// TENANT#<tenantId> and TENANT#<tenantId>#USER#<userId>. This is the only
// entry point tenantId ever comes through, so a delimiter character (#, /,
// whitespace, ...) inside the value must be rejected here -- once it is past
// this check it is trusted everywhere downstream.
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function principalFromClaims(claims: Record<string, unknown>): TenantPrincipal {
  const tenantId = claims['custom:tenant_id'];
  const userId = claims['sub'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new UnauthorizedException('token is missing the custom:tenant_id claim');
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new UnauthorizedException('token has a malformed custom:tenant_id claim');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException('token is missing the sub claim');
  }
  const role = claims['custom:role'];
  return { tenantId, userId, role: typeof role === 'string' ? role : null };
}
