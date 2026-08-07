import { sanitiseFilename, buildObjectKey } from './object-key';

describe('sanitiseFilename', () => {
  it('keeps a reasonable name intact', () => {
    expect(sanitiseFilename('desk-chair.jpg')).toBe('desk-chair.jpg');
  });

  // The filename arrives from the browser and lands inside an S3 key. Without
  // this, a caller could write outside its own tenant prefix -- the one thing
  // the key layout exists to guarantee.
  it('strips path traversal and directory separators', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('a/b/c.png')).toBe('c.png');
    expect(sanitiseFilename('..\\..\\windows\\evil.png')).toBe('evil.png');
  });

  it('replaces characters that are awkward in a URL', () => {
    expect(sanitiseFilename('my photo (1)#2.png')).toBe('my-photo-1-2.png');
  });

  it('falls back to a generic name when nothing usable survives', () => {
    expect(sanitiseFilename('...')).toBe('upload');
    expect(sanitiseFilename('   ')).toBe('upload');
  });

  it('caps the length', () => {
    expect(sanitiseFilename(`${'a'.repeat(300)}.png`).length).toBeLessThanOrEqual(100);
  });
});

describe('buildObjectKey', () => {
  it('namespaces by tenant and upload', () => {
    expect(buildObjectKey('acme', '01J0000000000000000000000A', 'chair.png')).toBe(
      'acme/products/01J0000000000000000000000A/chair.png',
    );
  });

  it('cannot be escaped by a hostile filename', () => {
    const key = buildObjectKey('acme', '01J0000000000000000000000A', '../../globex/steal.png');
    expect(key.startsWith('acme/products/')).toBe(true);
    expect(key).not.toContain('..');
  });
});
