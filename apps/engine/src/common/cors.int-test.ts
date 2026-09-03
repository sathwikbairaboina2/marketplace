import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

describe('CORS', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'http://localhost:33002,http://*.localhost:33002';
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.QUEUE_URL ??=
      'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:36379';
    process.env.JWKS_URI ??= 'http://localhost:39229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:39229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // RedisModule's provider is a bare `new Redis(env.REDIS_URL, ...)` with no
    // `lazyConnect` and no Nest `onModuleDestroy`, so `app.close()` alone leaves
    // the connection open and Jest warns about an open handle.
    //
    // Wait for `ready` first: this suite finishes faster than ioredis's ready
    // handshake, and quitting mid-handshake makes the server reset the socket.
    // ioredis treats that ECONNRESET as fatal and schedules a 2000ms
    // non-unref'd `disconnectTimeout`, which outlives the suite and makes Jest
    // report "a worker process has failed to exit gracefully". Same reasoning
    // as docs/openapi-document.int-test.ts -- do not simplify.
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
    await redis.quit();
    await app.close();
    delete process.env.CORS_ORIGINS;
  });

  it('allows the configured origin and the headers the client sends', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:33002',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,idempotency-key',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:33002');
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowed).toContain('authorization');
    // POST /orders and POST /bookings require this header. A preflight that
    // drops it turns every order into an opaque browser-side CORS failure.
    expect(allowed).toContain('idempotency-key');
  });

  // Every method a controller answers has to be named in the preflight, or the
  // browser refuses before it sends anything: the request is well formed, the
  // URL is right, the server is healthy, and nothing arrives. It has already
  // happened twice here -- once for PUT on the announcement, once for PATCH on
  // a product -- so it is asserted per method rather than described in a
  // comment.
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('allows %s through the preflight', async (method) => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:33002',
        'Access-Control-Request-Method': method,
        'Access-Control-Request-Headers': 'authorization',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:33002');
    const allowedMethods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    expect(allowedMethods).toContain(method);
  });

  it('does not allow an unconfigured origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('http://evil.example');
  });

  it('allows a shop subdomain under the wildcard entry', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://acme.localhost:33002', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://acme.localhost:33002');
  });

  it('refuses a two-label host the wildcard does not cover', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://a.b.localhost:33002', 'Access-Control-Request-Method': 'GET' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});
