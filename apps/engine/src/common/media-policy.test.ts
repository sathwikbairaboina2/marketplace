import { foreignMediaUrl } from './media-policy';

describe('foreignMediaUrl', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env.S3_PUBLIC_ENDPOINT = OLD.S3_PUBLIC_ENDPOINT;
    process.env.S3_BUCKET = OLD.S3_BUCKET;
  });

  const configure = () => {
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:4566';
    process.env.S3_BUCKET = 'marketplace-media';
  };

  it('accepts the tenant own media', () => {
    configure();
    expect(
      foreignMediaUrl(['http://localhost:4566/marketplace-media/acme/products/x/y.png'], 'acme'),
    ).toBeNull();
  });

  it('names another tenant media as foreign', () => {
    configure();
    const url = 'http://localhost:4566/marketplace-media/globex/products/x/y.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('names an external host as foreign', () => {
    configure();
    const url = 'https://evil.example/img.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('cannot be fooled by a tenant id that prefixes another', () => {
    configure();
    // acme must not accept acme2's media: the prefix ends with a slash.
    const url = 'http://localhost:4566/marketplace-media/acme2/products/x/y.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('is not fooled by dot-segment traversal out of the tenant prefix', () => {
    configure();
    // Browsers normalise this to .../globex/... before requesting it.
    const url = 'http://localhost:4566/marketplace-media/acme/../globex/products/x/y.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('is not fooled by backslash separators in an http URL', () => {
    configure();
    // WHATWG URL parsing turns http(s) backslashes into slashes.
    const url = 'http://localhost:4566/marketplace-media/acme\\..\\globex/products/x/y.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('refuses an encoded dot-segment rather than serving a key that cannot exist', () => {
    configure();
    const url = 'http://localhost:4566/marketplace-media/acme/%2e%2e/globex/products/x.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('refuses an unparseable URL as foreign', () => {
    configure();
    expect(foreignMediaUrl(['not a url'], 'acme')).toBe('not a url');
  });

  it('compares the origin exactly, not as a string prefix', () => {
    configure();
    const url = 'http://localhost:45660/marketplace-media/acme/products/x.png';
    expect(foreignMediaUrl([url], 'acme')).toBe(url);
  });

  it('passes everything through when S3 is not configured', () => {
    delete process.env.S3_PUBLIC_ENDPOINT;
    delete process.env.S3_BUCKET;
    expect(foreignMediaUrl(['https://anything.example/x.png'], 'acme')).toBeNull();
  });
});
