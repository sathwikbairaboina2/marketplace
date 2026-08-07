import { sniffImageType } from './image-type';

const bytes = (...values: number[]) => Buffer.from(values);

// Real leading bytes for each accepted format, padded so length checks pass.
const JPEG = Buffer.concat([bytes(0xff, 0xd8, 0xff, 0xe0), Buffer.alloc(16)]);
const PNG = Buffer.concat([bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), Buffer.alloc(16)]);
const GIF87 = Buffer.concat([Buffer.from('GIF87a', 'ascii'), Buffer.alloc(16)]);
const GIF89 = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(16)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  bytes(0x00, 0x00, 0x00, 0x00),
  Buffer.from('WEBP', 'ascii'),
  Buffer.alloc(16),
]);

describe('sniffImageType', () => {
  it('identifies each supported format from its leading bytes', () => {
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(GIF87)).toBe('image/gif');
    expect(sniffImageType(GIF89)).toBe('image/gif');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  // The point of the whole function: a declared content type is a claim by the
  // uploader, and these objects are served publicly from the media bucket.
  it('does not identify content that merely claims to be an image', () => {
    expect(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', 'ascii'))).toBeNull();
    expect(sniffImageType(Buffer.from('<!doctype html><script>alert(1)</script>', 'ascii'))).toBeNull();
    expect(sniffImageType(Buffer.from('%PDF-1.7', 'ascii'))).toBeNull();
  });

  it('returns null for a buffer too short to identify', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
  });

  it('does not mistake RIFF that is not WEBP for an image', () => {
    // A WAV file also starts with RIFF.
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      bytes(0x00, 0x00, 0x00, 0x00),
      Buffer.from('WAVE', 'ascii'),
      Buffer.alloc(16),
    ]);
    expect(sniffImageType(wav)).toBeNull();
  });
});
