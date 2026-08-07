import { PresignUploadSchema, PresignedUploadSchema, IMAGE_CONTENT_TYPES } from './upload';

describe('upload contracts', () => {
  it('accepts a supported image type', () => {
    expect(
      PresignUploadSchema.parse({ filename: 'chair.jpg', contentType: 'image/jpeg' }).contentType,
    ).toBe('image/jpeg');
  });

  it('rejects a content type outside the allow-list', () => {
    expect(
      PresignUploadSchema.safeParse({ filename: 'x.svg', contentType: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(
      PresignUploadSchema.safeParse({ filename: 'x.pdf', contentType: 'application/pdf' }).success,
    ).toBe(false);
  });

  it('rejects an empty or oversized filename', () => {
    expect(PresignUploadSchema.safeParse({ filename: '', contentType: 'image/png' }).success).toBe(
      false,
    );
    expect(
      PresignUploadSchema.safeParse({ filename: 'a'.repeat(300), contentType: 'image/png' }).success,
    ).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(
      PresignUploadSchema.safeParse({
        filename: 'a.png',
        contentType: 'image/png',
        bucket: 'somewhere-else',
      }).success,
    ).toBe(false);
  });

  it('describes the presigned post the browser has to submit', () => {
    const parsed = PresignedUploadSchema.parse({
      url: 'http://localhost:4566/marketplace-media',
      fields: { key: 'acme/products/01J/x.png', 'Content-Type': 'image/png', Policy: 'abc' },
      objectUrl: 'http://localhost:4566/marketplace-media/acme/products/01J/x.png',
    });
    expect(parsed.fields.key).toContain('acme/products');
  });

  it('lists exactly the four supported types', () => {
    expect([...IMAGE_CONTENT_TYPES]).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]);
  });
});
