import { z } from 'zod';
import { createServer, Server, Socket, AddressInfo } from 'node:net';
import { ChatMessage } from '@marketplace/contracts';
import { OllamaLlmProvider } from './ollama.provider';
import { EnvConfig } from '../config/env.schema';

// 25103, not ollama's default 11434: this is the only test in the repo that
// calls a model for real, so it is the only one that has to agree with where
// docker/docker-compose.yml points `agents` -- the shared `research-ollama`
// daemon that holds qwen3.8:27b for several projects on this machine. 11434 is
// what every other ollama answers on; pointed there this test reaches a daemon
// that has never heard of the model and fails as `llm-unavailable`, which reads
// as a broken provider rather than a misaddressed one.
const env = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:25103',
  LLM_MODEL: process.env.LLM_MODEL ?? 'qwen3.8:27b',
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

  it('reports a synchronous throw from the model call as llm-unavailable via the wrap branch', async () => {
    // Regression test: `guard()`'s call to `fn()` must stay inside its own try
    // block. A prior revision moved `fn()` (and its `.catch` sink) above the
    // `try`, so a *synchronous* throw -- as opposed to an async rejection, which
    // is all the other tests here produce -- escaped `guard()` entirely instead
    // of being classified as 503 llm-unavailable, and also skipped the `finally`
    // that clears the timeout timer.
    //
    // `guard` is private, but there is a public seam: `toLangChain(...)` runs
    // synchronously as an argument to `this.model.invoke(...)` inside the
    // closure `text()` passes to `guard`, so it executes during `guard`'s own
    // `fn()` call -- inside its try block -- exactly like the direct
    // synchronous throw this test used to construct by reaching into `guard`
    // via a cast. A `messages` array `.map` can't be called on forces that
    // same synchronous throw, reachable through the public `text()` API.
    // `messages` is cast at the call site (not typed as `any`) because this is
    // deliberately exercising runtime behaviour at a typed boundary that
    // TypeScript itself would otherwise reject.
    const provider = new OllamaLlmProvider(env);
    const notAnArray = null as unknown as ChatMessage[];

    await expect(
      provider.text({ system: '', messages: notAnArray }),
    ).rejects.toMatchObject({
      problem: { status: 503, title: 'Model call failed' },
    });
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
