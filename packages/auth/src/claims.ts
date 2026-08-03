import { AuthError } from './errors';
import { TenantPrincipal } from './tenant-context';

// Later tasks embed tenantId directly in single-table composite keys such as
// TENANT#<tenantId> and TENANT#<tenantId>#USER#<userId>. This is the primary
// entry point tenantId ever comes through, so a delimiter character (#, /,
// whitespace, ...) inside the value must be rejected here -- once it is past
// this check it is trusted everywhere downstream.
//
// Exported because the Engine's SQS consumer is a second, unauthenticated
// entry point for a tenant id -- MessagingAgents pushes `tenantId` on the
// queue with no JWT behind it -- and it must enforce this exact same pattern
// before that value ever reaches a key. Keeping one exported constant (rather
// than a second copy of the regex) guarantees the two chokepoints can never
// drift apart.
export const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function principalFromClaims(claims: Record<string, unknown>): TenantPrincipal {
  const tenantId = claims['custom:tenant_id'];
  const userId = claims['sub'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new AuthError('token is missing the custom:tenant_id claim');
  }
  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new AuthError('token has a malformed custom:tenant_id claim');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AuthError('token is missing the sub claim');
  }
  const role = claims['custom:role'];
  return { tenantId, userId, role: typeof role === 'string' ? role : null };
}
