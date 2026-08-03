import { Inject, Injectable } from '@nestjs/common';
import { ChatOllama } from '@langchain/ollama';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatMessage } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { LlmProvider, StructuredRequest, TextRequest } from './llm.provider';

function toLangChain(system: string, messages: ChatMessage[]): BaseMessage[] {
  const head: BaseMessage[] = system ? [new SystemMessage(system)] : [];
  return head.concat(
    messages.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
  );
}

@Injectable()
export class OllamaLlmProvider implements LlmProvider {
  private readonly model: ChatOllama;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.model = new ChatOllama({
      model: env.LLM_MODEL,
      baseUrl: env.OLLAMA_BASE_URL,
      temperature: env.LLM_TEMPERATURE,
    });
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const runnable = this.model.withStructuredOutput(req.schema, { name: req.name });
    return this.guard(() => runnable.invoke(toLangChain(req.system, req.messages)) as Promise<T>);
  }

  async text(req: TextRequest): Promise<string> {
    const message = await this.guard(() => this.model.invoke(toLangChain(req.system, req.messages)));
    return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  }

  /**
   * A model that is down or wedged must not hang a socket handler forever.
   * Both failures surface as one problem type, because the caller's recovery is
   * identical: the checkpoint is intact and the user can retry.
   */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new ProblemException('llm-unavailable', 503, 'Model timed out')),
        this.env.LLM_TIMEOUT_MS,
      );
    });
    try {
      const call = fn();
      // If the timeout wins the race, `call` is still pending and may reject later
      // (e.g. the socket errors once a caller tears down the connection after the
      // fact). Nothing awaits `call` past this point, so an unhandled rejection
      // would otherwise surface once it eventually settles; swallow it here. The
      // rejection this listener sees is never the one `Promise.race` reports below.
      call.catch(() => {});
      return await Promise.race([call, timeout]);
    } catch (err) {
      if (err instanceof ProblemException) throw err;
      throw new ProblemException(
        'llm-unavailable',
        503,
        'Model call failed',
        (err as Error).message,
      );
    } finally {
      clearTimeout(timer!);
    }
  }
}
