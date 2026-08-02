import { baseUrl, waitForHealthy } from './setup';

describe('health', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('reports liveness', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(res.status).toBe(200);
  });

  it('reports readiness once dynamodb and redis are reachable', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dynamodb: 'ok', redis: 'ok' });
  });
});
