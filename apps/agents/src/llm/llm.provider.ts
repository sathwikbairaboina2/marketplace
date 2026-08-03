import { ZodType } from 'zod';
import { ChatMessage } from '@marketplace/contracts';

export const LLM = Symbol('LLM');

export interface StructuredRequest<T> {
  system: string;
  messages: ChatMessage[];
  schema: ZodType<T>;
  /** Names the response object for the model; some backends surface it in the schema. */
  name: string;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
}

export interface LlmProvider {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  text(req: TextRequest): Promise<string>;
}
