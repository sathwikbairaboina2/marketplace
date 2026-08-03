import { z } from 'zod';
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

  it('reports an unreachable model endpoint as llm-unavailable', async () => {
    const broken = new OllamaLlmProvider({ ...env, OLLAMA_BASE_URL: 'http://127.0.0.1:1' } as EnvConfig);
    await expect(
      broken.text({ system: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ problem: { status: 503 } });
  });
});
