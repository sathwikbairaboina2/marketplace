import { IMAGE_CONTENT_TYPES, type ImageContentType } from '@marketplace/contracts';

/**
 * Identifies an image from its leading bytes, or returns null.
 *
 * The uploader's declared `Content-Type` is a claim, not a fact, and these
 * objects are served publicly from the media bucket. Reading the magic number
 * is what stops an HTML or SVG payload arriving labelled `image/png` and then
 * being served back under that label.
 *
 * Only the four formats in `IMAGE_CONTENT_TYPES` are recognised; everything
 * else -- including formats that are perfectly valid images -- is rejected,
 * because the allow-list is the contract.
 */
export function sniffImageType(buffer: Buffer): ImageContentType | null {
  if (buffer.length < 12) return null;

  // JPEG: SOI marker.
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  // PNG: fixed 8-byte signature.
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // GIF: 'GIF87a' or 'GIF89a'.
  const head6 = buffer.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif';

  // WebP: a RIFF container whose form type is 'WEBP'. The RIFF prefix alone is
  // not enough -- WAV and AVI share it.
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}

/** Narrowing helper for a value that arrived as an arbitrary string. */
export function isAllowedContentType(value: string): value is ImageContentType {
  return (IMAGE_CONTENT_TYPES as readonly string[]).includes(value);
}
