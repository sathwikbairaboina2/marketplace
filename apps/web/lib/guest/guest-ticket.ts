/**
 * The stranger's coat-check ticket, one per shop, in this browser only.
 * localStorage rather than a cookie: a cookie would travel to the platform
 * host and the cockpit, and every call that needs the ticket is already a
 * same-origin request that can carry a header. Wrapped in try/catch because
 * storage can be absent or refused, and a shop must still render then.
 */
const key = (tenantId: string) => `marketplace.guest.${tenantId}`;

export function readGuestTicket(tenantId: string): string | null {
  try {
    return localStorage.getItem(key(tenantId));
  } catch {
    return null;
  }
}

export function writeGuestTicket(tenantId: string, ticket: string): void {
  try {
    localStorage.setItem(key(tenantId), ticket);
  } catch {
    // Nothing to do: the ticket lives for this page only.
  }
}

export function clearGuestTicket(tenantId: string): void {
  try {
    localStorage.removeItem(key(tenantId));
  } catch {
    // Same.
  }
}
