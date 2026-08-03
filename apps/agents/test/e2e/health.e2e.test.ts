import { agentsBaseUrl, waitForAgentsHealthy } from './setup';

describe('agents health', () => {
  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  it('reports liveness', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/health/live`);
    expect(res.status).toBe(200);
  });

  it('reports readiness once redis, ollama and the engine are reachable', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ redis: 'ok', ollama: 'ok', engine: 'ok' });
  });

  it('returns problem+json for an unknown route', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
