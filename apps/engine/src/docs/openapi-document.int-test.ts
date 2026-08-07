import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

const ENGINE_ROUTES = [
  '/api/v1/products',
  '/api/v1/products/{id}',
  '/api/v1/products/search',
  '/api/v1/events',
  '/api/v1/events/{id}',
  '/api/v1/orders',
  '/api/v1/orders/{id}',
  '/api/v1/bookings',
  '/api/v1/bookings/{id}',
  '/api/v1/flows',
  '/api/v1/flows/{id}/execute',
  '/api/v1/flows/{id}',
  '/api/v1/schemas',
  '/api/v1/schemas/{entityType}',
  '/api/v1/me',
  '/api/v1/health/live',
  '/api/v1/health/ready',
];

describe('OpenAPI document shape (engine)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let document: any;

  beforeAll(async () => {
    process.env.DOCS_ENABLED = 'true';
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/api/v1/docs-json`);
    document = await res.json();
  });

  afterAll(async () => {
    // RedisModule's provider is a bare `new Redis(env.REDIS_URL, ...)` with no
    // `lazyConnect` and no Nest `onModuleDestroy`, so `app.close()` alone
    // leaves the connection open -- Jest then warns about an open handle. Quit
    // it explicitly before closing the app.
    //
    // Wait for `ready` first: these suites finish faster than ioredis's ready
    // handshake, and quitting mid-handshake makes the server reset the socket.
    // ioredis treats that ECONNRESET as a fatal error and schedules a 2000ms
    // non-unref'd `disconnectTimeout`, which outlives the suite and makes Jest
    // report "a worker process has failed to exit gracefully".
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
    await redis.quit();
    await app.close();
  });

  it('has a path item for every registered route', () => {
    for (const route of ENGINE_ROUTES) {
      expect(document.paths).toHaveProperty(route);
    }
  });

  it('requires name in the POST /products request body', () => {
    const schema = document.paths['/api/v1/products'].post.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('name');
  });

  it('lists limit and cursor as query parameters on GET /products', () => {
    const params = document.paths['/api/v1/products'].get.parameters as Array<{ name: string }>;
    expect(params.map((p) => p.name).sort()).toEqual(['cursor', 'limit']);
  });

  it('marks both health operations as not requiring the bearer token', () => {
    expect(document.paths['/api/v1/health/live'].get.security).toEqual([]);
    expect(document.paths['/api/v1/health/ready'].get.security).toEqual([]);
  });

  it('gives every operation a default problem response', () => {
    for (const pathItem of Object.values(document.paths) as Array<Record<string, any>>) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses).toHaveProperty('default');
      }
    }
  });
});
