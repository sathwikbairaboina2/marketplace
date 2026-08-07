import { ImageContentTypeSchema, UploadedImageSchema, IMAGE_CONTENT_TYPES } from './upload';

describe('upload contracts', () => {
  it('accepts every supported image type', () => {
    for (const type of IMAGE_CONTENT_TYPES) {
      expect(ImageContentTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects a type outside the allow-list', () => {
    // SVG in particular: it is a scriptable document, and these objects are
    // served publicly.
    expect(ImageContentTypeSchema.safeParse('image/svg+xml').success).toBe(false);
    expect(ImageContentTypeSchema.safeParse('application/pdf').success).toBe(false);
    expect(ImageContentTypeSchema.safeParse('text/html').success).toBe(false);
  });

  it('lists exactly the four supported types', () => {
    expect([...IMAGE_CONTENT_TYPES]).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
  });

  it('describes the uploaded image response', () => {
    const parsed = UploadedImageSchema.parse({
      objectUrl: 'http://localhost:4566/marketplace-media/acme/products/01J/x.png',
    });
    expect(parsed.objectUrl).toContain('acme/products');
  });

  it('rejects a response that is not a URL, or that carries extra keys', () => {
    expect(UploadedImageSchema.safeParse({ objectUrl: 'not-a-url' }).success).toBe(false);
    expect(
      UploadedImageSchema.safeParse({ objectUrl: 'http://x/y', key: 'leaked' }).success,
    ).toBe(false);
  });
});
