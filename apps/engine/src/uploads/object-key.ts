/**
 * The filename comes from the browser and ends up inside an S3 key, so it is
 * reduced to a bare basename over a conservative character set.
 *
 * Everything before the last separator is discarded rather than escaped or
 * filtered, which is what makes traversal impossible rather than merely
 * unlikely: there is no sequence of `..` or separators that can survive taking
 * the last segment.
 */
export function sanitiseFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 100);
  return cleaned.length > 0 ? cleaned : 'upload';
}

/**
 * `<tenantId>/products/<uploadId>/<filename>`.
 *
 * `uploadId` is a fresh ULID, not a product id: the product does not exist at
 * upload time, because the engine has no update routes and images must
 * therefore be supplied when it is created. The tenant prefix keeps a
 * tenant-checked read path available later as a policy change rather than a
 * data migration.
 */
export function buildObjectKey(tenantId: string, uploadId: string, filename: string): string {
  return `${tenantId}/products/${uploadId}/${sanitiseFilename(filename)}`;
}
