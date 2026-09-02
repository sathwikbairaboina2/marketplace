import { Injectable } from '@nestjs/common';
import { TENANT_ID_PATTERN } from '@marketplace/auth';
import { ProblemException } from '../common/problem';
import { runWithTenant, TenantPrincipal } from '../common/tenant-context';

/**
 * The public storefront's way into a tenant.
 *
 * Every other request derives its tenant from a verified JWT claim; this is
 * the second place a tenant id enters from outside (the SQS consumer is the
 * third) and it enforces the same pattern before the value can reach a
 * partition key. A stranger asking for a shop that fails the pattern is told
 * there is no such shop -- not that the id is malformed, which is one more
 * fact than they need.
 *
 * The principal has role `public`, which no `@Roles()` list and no service
 * admin check accepts, and a userId that owns nothing.
 */
@Injectable()
export class ShopScope {
  run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    if (!TENANT_ID_PATTERN.test(tenantId)) {
      return Promise.reject(new ProblemException('not-found', 404, 'No such shop'));
    }
    const principal: TenantPrincipal = { tenantId, userId: 'anonymous', role: 'public' };
    return runWithTenant(principal, fn);
  }
}
