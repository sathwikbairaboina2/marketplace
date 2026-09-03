/**
 * Which browser origins a service answers. Shared by the engine and the
 * agents: both are called from the browser, and a shop origin the engine
 * admits but the agents refuse is a storefront where the support box says
 * "Failed to fetch" -- which is exactly how this file came to move here.
 *
 * Exact entries match exactly, as they always have. An entry whose host
 * starts with `*.` matches one label in front of the rest -- the
 * shop-per-subdomain scheme the storefront uses (`acme.localhost:3002`) --
 * and only one: `a.b.localhost` is not a shop and is refused. Scheme and port
 * must match exactly; a wildcard never widens either.
 */
const LABEL = /^[A-Za-z0-9_-]{1,64}$/;
const WILDCARD = '://*.';

export function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

export function originAllowed(origin: string | undefined, patterns: readonly string[]): boolean {
  if (!origin) return false;
  for (const pattern of patterns) {
    if (pattern === origin) return true;
    const star = pattern.indexOf(WILDCARD);
    if (star === -1) continue;
    const scheme = pattern.slice(0, star + '://'.length);
    const rest = pattern.slice(star + WILDCARD.length);
    if (!origin.startsWith(scheme)) continue;
    const host = origin.slice(scheme.length);
    if (!host.endsWith(`.${rest}`)) continue;
    const label = host.slice(0, host.length - rest.length - 1);
    if (LABEL.test(label)) return true;
  }
  return false;
}
