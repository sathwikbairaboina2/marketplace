import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import type { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';
import { CHECKPOINTER } from '../graph/checkpointer';

const AGENTS_ROUTES = ['/api/v1/health/live', '/api/v1/health/ready', '/api/v1/threads/{id}'];

describe('OpenAPI document shape (agents)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let document: any;

  beforeAll(async () => {
    process.env.DOCS_ENABLED = 'true';
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.ENGINE_BASE_URL ??= 'http://localhost:3000';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';
    process.env.OLLAMA_BASE_URL ??= 'http://localhost:11434';

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
    // `GraphModule`'s checkpointer holds a second, separate Redis connection
    // (`RedisSaver`'s own `redis` client), which Nest knows nothing about --
    // the same disposal `graph.service.int-test.ts` does.
    await app.get<RedisSaver>(CHECKPOINTER).end();
    await app.close();
  });

  it('has a path item for every registered route', () => {
    for (const route of AGENTS_ROUTES) {
      expect(document.paths).toHaveProperty(route);
    }
  });

  it('marks both health operations as not requiring the bearer token', () => {
    expect(document.paths['/api/v1/health/live'].get.security).toEqual([]);
    expect(document.paths['/api/v1/health/ready'].get.security).toEqual([]);
  });

  it('documents the 200 response of threads/:id with the AgentStateSnapshot schema', () => {
    const schema =
      document.paths['/api/v1/threads/{id}'].get.responses['200'].content['application/json'].schema;
    expect(schema.properties).toHaveProperty('threadId');
    expect(schema.properties).toHaveProperty('phase');
  });

  it('gives every operation a default problem response', () => {
    for (const pathItem of Object.values(document.paths) as Array<Record<string, any>>) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses).toHaveProperty('default');
      }
    }
  });
});
