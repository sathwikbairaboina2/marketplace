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

  it('passes everything through when S3 is not configured', () => {
    delete process.env.S3_PUBLIC_ENDPOINT;
    delete process.env.S3_BUCKET;
    expect(foreignMediaUrl(['https://anything.example/x.png'], 'acme')).toBeNull();
  });
});
