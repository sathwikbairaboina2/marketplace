import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

/**
 * The two things a public HTTP surface is expected to do for itself: say how it
 * may be embedded and sniffed, and refuse to be hammered.
 *
 * Asserted against a real application rather than against the options object,
 * because both are middleware whose ordering decides whether they run at all.
 */
describe('hardening', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.QUEUE_URL ??=
      'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
    process.env.JWKS_URI ??= 'http://127.0.0.1:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://127.0.0.1:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';
    // Small enough to reach in a test without a thousand requests.
    process.env.RATE_LIMIT = '5';
    process.env.RATE_LIMIT_WINDOW_MS = '2000';

    app = await createApp();
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') await new Promise((r) => redis.once('ready', r));
    await app.close();
    await redis.quit();
  });

  it('says it must not be framed', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    const header = (res.headers.get('x-frame-options') ?? '').toUpperCase();
    expect(['DENY', 'SAMEORIGIN']).toContain(header);
  });

  it('says its content types must not be sniffed', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not leak the full URL to other origins as a referrer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });

  // Announcing the framework tells an attacker which CVE list to work through
  // and tells a user nothing.
  it('does not advertise the framework it is built on', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('refuses a caller who exceeds the rate limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await fetch(`${baseUrl}/api/v1/products`);
      statuses.push(res.status);
    }

    expect(statuses).toContain(429);
  });

  it('answers a refusal as a problem document, not bare text', async () => {
    let problem: Response | null = null;
    for (let i = 0; i < 12 && !problem; i += 1) {
      const res = await fetch(`${baseUrl}/api/v1/products`);
      if (res.status === 429) problem = res;
    }

    expect(problem).not.toBeNull();
    expect(problem!.headers.get('content-type')).toContain('application/problem+json');
    const body = (await problem!.json()) as { title?: string; status?: number };
    expect(body.status).toBe(429);
    expect(body.title).toBeTruthy();
  });

  // Liveness is what an orchestrator polls every few seconds; rate-limiting it
  // would make the engine look dead under exactly the load it is meant to
  // survive.
  it('does not rate-limit the liveness probe', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 25; i += 1) {
      const res = await fetch(`${baseUrl}/api/v1/health/live`);
      statuses.push(res.status);
    }

    expect(statuses.every((s) => s === 200)).toBe(true);
  });
});
