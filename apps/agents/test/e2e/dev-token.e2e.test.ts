import { ulid } from 'ulid';
import { agentsBaseUrl, engineBaseUrl, waitForAgentsHealthy } from './setup';

async function mintDevToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

describe('dev-token pre-fill (docker)', () => {
  beforeAll(async () => {
    await waitForAgentsHealthy();
  }, 300_000);

  it('mints a token from the engine that GET /me accepts', async () => {
    const token = await mintDevToken(engineBaseUrl);
    const res = await fetch(`${engineBaseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('mints a token from agents that GET /threads/:id accepts', async () => {
    const token = await mintDevToken(agentsBaseUrl);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${ulid()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    // A random id belongs to no thread, so the expected outcome is a 404
    // "no such thread" -- not a 401. A 404 here is proof the token was
    // accepted; a 401 would mean the dev-token pre-fill path is broken.
    expect(res.status).toBe(404);
  });
});
