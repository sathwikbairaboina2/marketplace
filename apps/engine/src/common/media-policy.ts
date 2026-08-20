/**
 * Public media isolation (#05).
 *
 * Object keys are already tenant-prefixed at upload time; what nothing
 * enforced was the other direction -- a product or banner could carry ANY
 * image URL, hotlinking another tenant's media or an arbitrary external
 * host into a storefront this platform serves. A stored image URL must
 * point into the calling tenant's own slice of the media bucket.
 *
 * Compared as a PARSED URL, never as a raw string prefix: browsers
 * normalise dot segments (`acme/../globex` serves globex) and, for http(s),
 * backslashes into slashes, so a string `startsWith` would wave through
 * exactly the traversal this check exists to stop. `new URL(...)` applies
 * the same normalisation the browser will, and the comparison happens on
 * the result. An encoded `%2e%2e` survives parsing un-normalised and then
 * simply fails the literal prefix comparison -- there is no key containing
 * `%2e%2e` to serve.
 *
 * Read from process.env rather than the ENV provider so callers stay plain
 * functions; when S3 is not configured there is no legitimate media URL at
 * all, and the check passes everything through unchanged -- an S3-less
 * deployment has no bucket to police.
 */
export function foreignMediaUrl(urls: readonly string[], tenantId: string): string | null {
  const endpoint = process.env.S3_PUBLIC_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  if (!endpoint || !bucket) return null;

  let expectedOrigin: string;
  try {
    expectedOrigin = new URL(endpoint).origin;
  } catch {
    // A malformed endpoint would otherwise disable the policy silently;
    // treating every URL as foreign fails closed instead.
    return urls[0] ?? 'unparseable S3_PUBLIC_ENDPOINT';
  }

  const pathPrefix = `/${bucket}/${tenantId}/`;
  return (
    urls.find((url) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return true; // Unparseable is foreign by definition.
      }
      return parsed.origin !== expectedOrigin || !parsed.pathname.startsWith(pathPrefix);
    }) ?? null
  );
}
