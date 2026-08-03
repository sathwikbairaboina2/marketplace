import { LlmProvider, StructuredRequest, TextRequest } from './llm.provider';

type RecordedCall = { system: string; messages: unknown[]; kind: 'structured' | 'text' };

/**
 * Test double. Queued values are still parsed through the caller's schema, so a
 * test cannot accidentally assert against a shape the real provider could never
 * return.
 */
export class ScriptedLlmProvider implements LlmProvider {
  private structuredQueue: unknown[] = [];
  private textQueue: string[] = [];
  readonly calls: RecordedCall[] = [];

  pushStructured(value: unknown): void {
    this.structuredQueue.push(value);
  }

  pushText(value: string): void {
    this.textQueue.push(value);
  }

  reset(): void {
    this.structuredQueue = [];
    this.textQueue = [];
    this.calls.length = 0;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.calls.push({ system: req.system, messages: req.messages, kind: 'structured' });
    if (this.structuredQueue.length === 0) {
      throw new Error(`scripted llm exhausted: no structured response queued for ${req.name}`);
    }
    return req.schema.parse(this.structuredQueue.shift());
  }

  async text(req: TextRequest): Promise<string> {
    this.calls.push({ system: req.system, messages: req.messages, kind: 'text' });
    if (this.textQueue.length === 0) {
      throw new Error('scripted llm exhausted: no text response queued');
    }
    return this.textQueue.shift()!;
  }
}
