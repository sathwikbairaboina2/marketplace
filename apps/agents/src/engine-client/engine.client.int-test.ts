import { EngineClient } from './engine.client';
import { EnvConfig } from '../config/env.schema';
import { tokenFor } from '../../test/e2e/helpers/auth';

const env = {
  ENGINE_BASE_URL: process.env.ENGINE_BASE_URL ?? 'http://localhost:33000',
  ENGINE_TIMEOUT_MS: 10_000,
} as EnvConfig;

jest.setTimeout(60_000);

describe('EngineClient', () => {
  const client = new EngineClient(env);

  it('reads an empty registry for a fresh tenant', async () => {
    const tenantId = `tenant_ec_${Math.random().toString(36).slice(2, 8)}`;
    const token = await tokenFor(tenantId, `ec-${Date.now()}@example.com`);
    const schema = await client.getSchema('Event', token);
    expect(schema).toEqual({ version: 0, fields: {} });
  });

  it('surfaces an invalid token as unauthorized', async () => {
    await expect(client.getSchema('Event', 'not-a-token')).rejects.toMatchObject({
      problem: { status: 401 },
    });
  });

  it('surfaces an unreachable engine as engine-unavailable', async () => {
    const broken = new EngineClient({ ...env, ENGINE_BASE_URL: 'http://127.0.0.1:1' } as EnvConfig);
    await expect(broken.getSchema('Event', 'whatever')).rejects.toMatchObject({
      problem: { status: 503 },
    });
  });
});
