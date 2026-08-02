import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantPrincipal {
  tenantId: string;
  userId: string;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantPrincipal>();

/** Wraps a callback in a tenant scope. Used by tests and the SQS consumer. */
export function runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

/**
 * Binds the tenant to the current *synchronous* execution and whatever it
 * spawns from here on, without a wrapping callback.
 *
 * Only safe to call from code that has not yet crossed an `await`: once a
 * function resumes after an `await`, a caller that is itself awaiting that
 * function's promise from an already-scheduled continuation will not observe
 * a store mutation made after the resumption. Concretely, JwtAuthGuard
 * cannot use this after verifying a token (verification is async), because
 * Nest's guards consumer awaits the guard from a continuation set up before
 * the guard resumes — see jwt-auth.guard.ts and tenant-context.interceptor.ts
 * for how request-scoped tenant binding is actually done.
 */
export function enterTenant(principal: TenantPrincipal): void {
  storage.enterWith(principal);
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
