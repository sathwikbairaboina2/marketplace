import { ImageGenClient } from './image-gen.client';

const config = { url: 'http://imagegen.local:8188', checkpoint: 'test.safetensors', timeoutMs: 5000 };

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

const jsonResponse = (body: unknown) =>
  ({ ok: true, json: () => Promise.resolve(body), arrayBuffer: () => Promise.resolve(png) }) as Response;

describe('ImageGenClient', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('submits, polls and returns the image bytes', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn((url: string | URL) => {
      const path = String(url);
      calls.push(path);
      if (path.endsWith('/prompt')) return Promise.resolve(jsonResponse({ prompt_id: 'p1' }));
      if (path.includes('/history/p1')) {
        return Promise.resolve(
          jsonResponse({
            p1: { outputs: { '7': { images: [{ filename: 'banner_0.png', subfolder: '', type: 'output' }] } } },
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }) as never;

    const client = new ImageGenClient(config);
    const bytes = await client.generate('wide storefront banner');

    expect(bytes.length).toBe(4);
    expect(calls.some((c) => c.includes('/view?filename=banner_0.png'))).toBe(true);
  });

  it('maps a rejected submit to image-gen-unavailable', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)) as never;

    const client = new ImageGenClient(config);
    await expect(client.generate('x')).rejects.toMatchObject({
      problem: expect.objectContaining({
        type: 'https://marketplace.local/problems/image-gen-unavailable',
        status: 503,
      }),
    });
  });

  it('gives up when the render never completes', async () => {
    global.fetch = jest.fn((url: string | URL) => {
      const path = String(url);
      if (path.endsWith('/prompt')) return Promise.resolve(jsonResponse({ prompt_id: 'p1' }));
      // History that never gains outputs.
      return Promise.resolve(jsonResponse({}));
    }) as never;

    const client = new ImageGenClient({ ...config, timeoutMs: 10 });
    await expect(client.generate('x')).rejects.toMatchObject({
      problem: expect.objectContaining({ status: 503 }),
    });
  });
});
