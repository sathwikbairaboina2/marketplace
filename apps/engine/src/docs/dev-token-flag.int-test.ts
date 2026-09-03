import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { DevTokenModule } from '@marketplace/openapi';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

describe('docs and dev-token are absent when DOCS_ENABLED is unset (engine)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DOCS_ENABLED;
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:36379';
    process.env.GUEST_SECRET ??= 'local-guest-secret-not-for-prod';
    process.env.JWKS_URI ??= 'http://localhost:39229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:39229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // See openapi-document.int-test.ts: RedisModule never closes its own
    // connection, so this test must -- and only once ioredis is `ready`.
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
    await redis.quit();
    await app.close();
  });

  it('404s on the docs UI', async () => {
    const res = await fetch(`${baseUrl}/api/v1/docs`);
    expect(res.status).toBe(404);
  });

  it('404s on the dev-token endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('DevTokenModule contributes no controller when DOCS_ENABLED is unset', () => {
    const mod = DevTokenModule.registerIfEnabled({
      DOCS_ENABLED: false,
      DEV_TENANT_ID: 'tenant-dev',
      DEV_USERNAME: 'dev@marketplace.local',
      AWS_REGION: 'us-east-1',
    });
    expect(mod.controllers ?? []).toHaveLength(0);
  });
});
