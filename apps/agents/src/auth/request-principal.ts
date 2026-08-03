import { TenantPrincipal } from '@marketplace/auth';

// Keyed by the Express request object (unique per request, garbage collected
// with it) rather than a mutated property, so this stays type-safe without
// augmenting Express's types.
const principals = new WeakMap<object, TenantPrincipal>();

/** Set by JwtAuthGuard once a token has been verified for this request. */
export function setTenantPrincipal(req: object, principal: TenantPrincipal): void {
  principals.set(req, principal);
}

/** Read by TenantContextInterceptor to bind the request's async context. */
export function getTenantPrincipal(req: object): TenantPrincipal | undefined {
  return principals.get(req);
}
