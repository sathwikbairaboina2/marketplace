// The same shape the engine's TENANT_ID_PATTERN accepts; a label that fails
// it could never name a shop, so it is not one.
const TENANT_LABEL = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED = new Set(['admin', 'www', 'api']);

/**
 * Which shop a hostname names, or null for the platform itself.
 *
 * Exactly one label in front of the platform host: `acme.localhost:3002` is
 * the acme shop, `localhost:3002` is the console as it always was, and
 * `a.b.localhost:3002` is nobody. Ports travel with the host string, so a
 * shop on another port is a different platform and answers null.
 */
export function shopFromHost(host: string, platformHost: string): string | null {
  const suffix = `.${platformHost.toLowerCase()}`;
  const lower = host.toLowerCase();
  if (!lower.endsWith(suffix)) return null;
  const label = host.slice(0, host.length - suffix.length);
  if (!TENANT_LABEL.test(label) || RESERVED.has(label.toLowerCase())) return null;
  return label;
}
