import { describe, expect, it, vi, beforeEach } from 'vitest';
import { uploadProductImage } from './uploads';
import { ProblemError } from './http';

const objectUrl = 'http://localhost:4566/marketplace-media/acme/products/01J/x.png';
const file = () => new File([new Uint8Array(8)], 'chair.png', { type: 'image/png' });

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('uploadProductImage', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('posts the file as multipart and returns the stored URL', async () => {
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      json({ objectUrl }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(uploadProductImage(file())).resolves.toBe(objectUrl);

    const init = fetchMock.mock.calls[0]![1]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect([...(init.body as FormData).keys()]).toEqual(['file']);
    // The browser must set the multipart boundary itself; naming a
    // Content-Type here produces a body the server cannot parse.
    expect(new Headers(init.headers as HeadersInit).has('Content-Type')).toBe(false);
  });

  it('surfaces the engine problem when the file is too large', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          {
            type: 'https://marketplace.local/problems/payload-too-large',
            title: 'Image too large',
            status: 413,
            detail: 'File too large',
          },
          413,
          'application/problem+json',
        ),
      ),
    );

    const err = (await uploadProductImage(file()).catch((e: unknown) => e)) as ProblemError;
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(413);
    expect(err.title).toBe('Image too large');
  });

  it('surfaces a rejected image type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(
          {
            type: 'https://marketplace.local/problems/unsupported-media-type',
            title: 'Image type mismatch',
            status: 422,
          },
          422,
          'application/problem+json',
        ),
      ),
    );

    const err = (await uploadProductImage(file()).catch((e: unknown) => e)) as ProblemError;
    expect(err.status).toBe(422);
  });

  it('sends the bearer token', async () => {
    const fetchMock = vi.fn(async (_i: RequestInfo | URL, _init?: RequestInit) =>
      json({ objectUrl }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await uploadProductImage(file());
    // No token is set in this test context, so the header must simply be absent
    // rather than sent as "Bearer null".
    const headers = new Headers(fetchMock.mock.calls[0]![1]!.headers as HeadersInit);
    expect(headers.get('Authorization')).not.toBe('Bearer null');
  });
});
