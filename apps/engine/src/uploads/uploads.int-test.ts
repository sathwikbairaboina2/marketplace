import type { EnvConfig } from '../config/env.schema';
// Re-exported from @marketplace/auth, which is what makes this the same
// AsyncLocalStorage the service's `currentPrincipal()` reads.
import { runWithTenant } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { UploadsService, type IncomingFile } from './uploads.service';

const BUCKET = 'marketplace-media';

/**
 * The service is constructed directly rather than resolved from a running app.
 *
 * `UploadsModule.registerIfEnabled` reads `process.env` while `@Module`'s
 * metadata is evaluated -- when `app.module.ts` is first imported, long before
 * any `beforeAll` could set `S3_BUCKET`. Booting the app here would always
 * produce a container with no `UploadsService` in it. The HTTP route is
 * exercised end to end in `apps/web/test/e2e/image-upload.spec.ts`, against a
 * container whose environment is set before the process starts.
 */
const env = {
  AWS_REGION: 'us-east-1',
  S3_BUCKET: BUCKET,
  S3_ENDPOINT: 'http://localhost:34566',
  S3_PUBLIC_ENDPOINT: 'http://localhost:34566',
  MAX_IMAGE_BYTES: 5_242_880,
} as EnvConfig;

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngFile = (overrides: Partial<IncomingFile> = {}): IncomingFile => {
  const buffer = Buffer.concat([PNG_HEADER, Buffer.alloc(64)]);
  return {
    buffer,
    originalname: 'chair.png',
    mimetype: 'image/png',
    size: buffer.length,
    ...overrides,
  };
};

describe('uploads (against LocalStack S3)', () => {
  const uploads = new UploadsService(env);

  const store = (file: IncomingFile, tenantId = 'acme') =>
    runWithTenant({ tenantId, userId: 'u1', role: 'admin' }, () => uploads.store(file));

  it('stores an image and serves it to an unauthenticated reader', async () => {
    const { objectUrl } = await store(pngFile());
    expect(objectUrl).toContain('acme/products/');

    // No credentials at all -- exactly how an <img> tag will load it. The
    // public-read path is the one thing here that genuinely depends on S3's own
    // behaviour, so it is asserted against S3 rather than assumed.
    const read = await fetch(objectUrl);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await read.arrayBuffer()).subarray(0, 8)).toEqual(PNG_HEADER);
  });

  it('keys uploads under the calling tenant', async () => {
    const { objectUrl } = await store(pngFile(), 'globex');
    expect(objectUrl).toContain(`/${BUCKET}/globex/products/`);
  });

  it('cannot be steered out of its tenant prefix by the filename', async () => {
    const { objectUrl } = await store(pngFile({ originalname: '../../globex/steal.png' }));
    expect(objectUrl).toContain(`/${BUCKET}/acme/products/`);
    expect(objectUrl).not.toContain('..');
  });

  it('rejects a declared type outside the allow-list before writing anything', async () => {
    await expect(store(pngFile({ mimetype: 'image/svg+xml' }))).rejects.toBeInstanceOf(
      ProblemException,
    );
  });

  // The check that matters: the declared type is a claim, the bytes are the
  // fact, and these objects are served publicly.
  it('rejects a payload whose contents are not an image at all', async () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'ascii');
    await expect(
      store(pngFile({ buffer: html, size: html.length })),
    ).rejects.toMatchObject({ problem: { status: 422 } });
  });

  it('rejects an image whose contents disagree with its declared type', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(32)]);
    await expect(
      store(pngFile({ buffer: gif, size: gif.length, mimetype: 'image/png' })),
    ).rejects.toMatchObject({ problem: { status: 422 } });
  });

  it('stores the sniffed content type, not the declared one', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.alloc(32)]);
    const { objectUrl } = await store(
      pngFile({ buffer: gif, size: gif.length, mimetype: 'image/gif', originalname: 'a.gif' }),
    );
    const read = await fetch(objectUrl);
    expect(read.headers.get('content-type')).toBe('image/gif');
  });
});
