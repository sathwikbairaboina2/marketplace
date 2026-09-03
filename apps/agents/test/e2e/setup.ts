import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../docker/.env.generated') });

export const agentsBaseUrl = process.env.AGENTS_BASE_URL ?? 'http://127.0.0.1:33001';
export const engineBaseUrl = process.env.ENGINE_BASE_URL ?? 'http://127.0.0.1:33000';

export async function waitForAgentsHealthy(timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${agentsBaseUrl}/api/v1/health/ready`);
      if (res.status === 200) return;
    } catch {
      // agents not listening yet
    }
    if (Date.now() > deadline) throw new Error('agents did not become healthy');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
