import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../docker/.env.generated') });

export const baseUrl = process.env.ENGINE_BASE_URL ?? 'http://127.0.0.1:33000';

export async function waitForHealthy(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health/ready`);
      if (res.status === 200) return;
    } catch {
      // engine not listening yet
    }
    if (Date.now() > deadline) throw new Error('engine did not become healthy');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
