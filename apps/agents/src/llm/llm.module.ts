import { Global, Module } from '@nestjs/common';
import { LLM } from './llm.provider';
import { OllamaLlmProvider } from './ollama.provider';

@Global()
@Module({
  providers: [OllamaLlmProvider, { provide: LLM, useExisting: OllamaLlmProvider }],
  exports: [LLM],
})
export class LlmModule {}
