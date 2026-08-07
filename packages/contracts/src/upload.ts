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

/**
 * What `POST /uploads/product-image` returns once the engine has validated the
 * bytes and written the object. The URL is publicly readable and is what ends
 * up stored in `ProductRecord.images`.
 *
 * The request has no schema here: it is `multipart/form-data`, not JSON, so
 * there is nothing for Zod to validate on the way in -- the engine validates
 * the file itself instead.
 */
export const UploadedImageSchema = z.object({ objectUrl: z.string().url() }).strict();
export type UploadedImage = z.infer<typeof UploadedImageSchema>;
