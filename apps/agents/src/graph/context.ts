import { TenantPrincipal } from '@marketplace/auth';

/**
 * Per-run identity. Held in a closure rather than in graph state or config,
 * because both of those are written to Redis by the checkpointer and a
 * persisted bearer token is a persisted credential.
 */
export interface RunContext {
  principal: TenantPrincipal;
  authToken: string;
  threadId: string;
}
