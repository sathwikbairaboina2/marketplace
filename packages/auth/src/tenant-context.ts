import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantPrincipal {
  tenantId: string;
  userId: string;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantPrincipal>();

/** Wraps a callback in a tenant scope. Used by tests, the SQS consumer and socket handlers. */
export function runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

export function currentPrincipal(): TenantPrincipal {
  const principal = storage.getStore();
  if (!principal) {
    throw new Error('no tenant context: this code must run inside runWithTenant');
  }
  return principal;
}

export function currentTenantId(): string {
  return currentPrincipal().tenantId;
}
