/**
 * The demo persona list and its shared dev password, read at request time.
 *
 * Deliberately not a `NEXT_PUBLIC_*` variable: those are inlined into the
 * client bundle by `next build`, so a value supplied later by compose would be
 * silently ignored. A route handler reads its environment per request, which is
 * what anything originating outside the image requires.
 *
 * Returns an empty list unless both variables are set, so a deployed build
 * exposes nothing -- the same posture as the engine's DOCS_ENABLED gate.
 */
export function GET() {
  const usernames = (process.env.DEV_PERSONAS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const password = process.env.DEV_PASSWORD ?? '';

  if (!usernames.length || !password) return Response.json({ personas: [] });
  return Response.json({ personas: usernames.map((username) => ({ username, password })) });
}
