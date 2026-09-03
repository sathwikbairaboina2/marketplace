import type { ZodType } from 'zod';
import { ENGINE_URL } from '../env';

/**
 * Where a server component reaches the engine. Inside the compose network
 * that is the service name, not the host-facing port the browser bundle was
 * built with; ENGINE_INTERNAL_URL is read at request time for that reason.
 */
export const engineInternalUrl = (): string =>
  (process.env.ENGINE_INTERNAL_URL ?? ENGINE_URL).replace(/\/+$/, '');

/**
 * A public read on behalf of a crawler. Null on 404 -- a product that is not
 * visible is not a page -- and on any other failure too: metadata is a
 * courtesy, and a broken engine must not turn a storefront into a 500 before
 * the client shell has had its chance to say what is wrong.
 */
export async function publicRead<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  try {
    const res = await fetch(`${engineInternalUrl()}${path}`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return schema.parse(await res.json());
  } catch {
    return null;
  }
}
