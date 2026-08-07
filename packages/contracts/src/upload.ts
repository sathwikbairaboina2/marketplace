import { z } from 'zod';

/**
 * Deliberately excludes `image/svg+xml`. SVG is a document format that can
 * carry script, and these objects are served publicly out of the media bucket
 * -- an uploaded SVG would be a stored-script vector dressed as a product
 * photograph.
 */
export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const ImageContentTypeSchema = z.enum(IMAGE_CONTENT_TYPES);
export type ImageContentType = z.infer<typeof ImageContentTypeSchema>;

export const PresignUploadSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: ImageContentTypeSchema,
  })
  .strict();
export type PresignUpload = z.infer<typeof PresignUploadSchema>;

/**
 * `url` and `fields` are posted verbatim as multipart/form-data by the browser,
 * with the file appended last -- S3 ignores every field that follows the file.
 * `objectUrl` is where the object becomes readable once that succeeds, and is
 * what ends up stored in `ProductRecord.images`.
 */
export const PresignedUploadSchema = z
  .object({
    url: z.string().url(),
    fields: z.record(z.string(), z.string()),
    objectUrl: z.string().url(),
  })
  .strict();
export type PresignedUpload = z.infer<typeof PresignedUploadSchema>;
