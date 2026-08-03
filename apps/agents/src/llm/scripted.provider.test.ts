import { z } from 'zod';
import { ScriptedLlmProvider } from './scripted.provider';

const Schema = z.object({ answer: z.string() });

describe('ScriptedLlmProvider', () => {
  it('returns queued structured values in order, parsed through the schema', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ answer: 'first' });
    llm.pushStructured({ answer: 'second' });

    const a = await llm.structured({ system: '', messages: [], schema: Schema, name: 'x' });
    const b = await llm.structured({ system: '', messages: [], schema: Schema, name: 'x' });
    expect([a.answer, b.answer]).toEqual(['first', 'second']);
  });

  it('rejects a queued value that does not match the schema', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ wrong: true });
    await expect(
      llm.structured({ system: '', messages: [], schema: Schema, name: 'x' }),
    ).rejects.toThrow();
  });

  it('fails loudly when the script is exhausted', async () => {
    const llm = new ScriptedLlmProvider();
    await expect(
      llm.structured({ system: '', messages: [], schema: Schema, name: 'x' }),
    ).rejects.toThrow(/scripted llm exhausted/);
  });

  it('records the requests it was given', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushText('hello');
    await llm.text({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toBe('sys');
  });
});
