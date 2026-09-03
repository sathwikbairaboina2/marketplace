/**
 * These are read in the browser, so they must point at host-facing ports --
 * a compose service name like `engine:3000` does not resolve there.
 *
 * `NEXT_PUBLIC_*` values are inlined into the client bundle by `next build`
 * (see apps/web/Dockerfile, which sets them before the build step). Nothing
 * that varies per run belongs here; runtime values come from route handlers,
 * which read their environment at request time.
 */
const strip = (url: string) => url.replace(/\/+$/, '');

export const ENGINE_URL = strip(
  process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:33000/api/v1',
);
export const AGENTS_URL = strip(process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:33001');

/** The host shops hang off: `<tenant>.<PLATFORM_HOST>` is a shop, the bare host is the console. */
export const PLATFORM_HOST = process.env.NEXT_PUBLIC_PLATFORM_HOST ?? 'localhost:33002';
