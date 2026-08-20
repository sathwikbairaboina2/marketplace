/**
 * Public media isolation (#05).
 *
 * Object keys are already tenant-prefixed at upload time; what nothing
 * enforced was the other direction -- a product or banner could carry ANY
 * image URL, hotlinking another tenant's media or an arbitrary external
 * host into a storefront this platform serves. A stored image URL must
 * point into the calling tenant's own slice of the media bucket.
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

  const prefix = `${endpoint.replace(/\/+$/, '')}/${bucket}/${tenantId}/`;
  return urls.find((url) => !url.startsWith(prefix)) ?? null;
}
