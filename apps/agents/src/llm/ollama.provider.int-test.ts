import { z } from 'zod';
import { createServer, Server, Socket, AddressInfo } from 'node:net';
import { OllamaLlmProvider } from './ollama.provider';
import { EnvConfig } from '../config/env.schema';

const env = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  LLM_MODEL: process.env.LLM_MODEL ?? 'qwen2.5:7b-instruct',
  LLM_TEMPERATURE: 0,
  LLM_TIMEOUT_MS: 120_000,
} as EnvConfig;

jest.setTimeout(180_000);

describe('OllamaLlmProvider', () => {
  const llm = new OllamaLlmProvider(env);

  it('returns an object matching the requested schema', async () => {
    const Schema = z.object({ capital: z.string(), isCity: z.boolean() });
    const out = await llm.structured({
      system: 'Answer factual questions. Respond only with the requested fields.',
      messages: [{ role: 'user', content: 'What is the capital city of France?' }],
      schema: Schema,
      name: 'capital_answer',
    });

    // Structural assertions only. The model's wording is not under test.
    expect(typeof out.capital).toBe('string');
    expect(typeof out.isCity).toBe('boolean');
  });

  it('reports an unreachable model endpoint as llm-unavailable via the connection-error path', async () => {
    const broken = new OllamaLlmProvider({ ...env, OLLAMA_BASE_URL: 'http://127.0.0.1:1' } as EnvConfig);
    await expect(
      broken.text({ system: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ problem: { status: 503, title: 'Model call failed' } });
  });

  describe('a model call that hangs', () => {
    // A raw TCP server that accepts the connection and then never responds and
    // never closes it. This makes the underlying HTTP request hang indefinitely,
    // so the only way `guard()` can resolve is via its own timeout race -- unlike
    // the ECONNREFUSED case above, there is no connection error to short-circuit
    // through the "wrap unknown error" branch instead.
    let server: Server;
    let port: number;
    const sockets = new Set<Socket>();

    beforeAll(async () => {
      server = createServer((socket) => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        // Deliberately no response, no close: the connection just sits open.
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    });

    it('reports it as llm-unavailable via the timeout path, not a connection error', async () => {
      const hung = new OllamaLlmProvider({
        ...env,
        OLLAMA_BASE_URL: `http://127.0.0.1:${port}`,
        LLM_TIMEOUT_MS: 300,
      } as EnvConfig);

      await expect(
        hung.text({ system: '', messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toMatchObject({ problem: { status: 503, title: 'Model timed out' } });
    });
  });
});
