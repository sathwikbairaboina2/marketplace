import { Inject, Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { EngineClient } from '../engine-client/engine.client';
import { AgentAnnotation, AgentState, PendingAction, toSnapshot } from './state';
import { RunContext } from './context';
import { CHECKPOINTER } from './checkpointer';
import { makeAnalyzeIntentNode } from './nodes/analyze-intent.node';
import { makeLoadRegistryNode } from './nodes/load-registry.node';

export interface RunInput {
  threadId: string;
  ctx: RunContext;
  action: PendingAction;
  content?: string;
}

@Injectable()
export class GraphService {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(LLM) private readonly llm: LlmProvider,
    private readonly engine: EngineClient,
    @Inject(CHECKPOINTER) private readonly checkpointer: RedisSaver,
  ) {}

  /**
   * Built per run rather than once, so nodes can close over the caller's
   * identity without it being written to the checkpoint. Compiling a handful of
   * nodes is cheap next to a single model call.
   */
  private build(ctx: RunContext) {
    const graph = new StateGraph(AgentAnnotation)
      .addNode('analyzeIntent', makeAnalyzeIntentNode({ llm: this.llm }))
      .addNode('loadRegistry', makeLoadRegistryNode({ engine: this.engine }, ctx))
      .addEdge(START, 'analyzeIntent')
      .addConditionalEdges('analyzeIntent', (state: AgentState) =>
        state.targetEntity ? 'loadRegistry' : END,
      )
      .addEdge('loadRegistry', END);

    return graph.compile({ checkpointer: this.checkpointer });
  }

  async run(input: RunInput): Promise<AgentStateSnapshot> {
    const app = this.build(input.ctx);
    const config = { configurable: { thread_id: input.threadId } };

    await app.invoke(
      {
        pendingAction: input.action,
        ...(input.content ? { messages: [new HumanMessage(input.content)] } : {}),
      },
      config,
    );

    return this.snapshot(input.threadId);
  }

  async snapshot(threadId: string): Promise<AgentStateSnapshot> {
    const app = this.build({ principal: { tenantId: '', userId: '', role: null }, authToken: '' });
    const state = await app.getState({ configurable: { thread_id: threadId } });
    return toSnapshot(threadId, state.values as AgentState);
  }
}
