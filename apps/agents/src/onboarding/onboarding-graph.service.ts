import { Inject, Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { OnboardingSnapshot } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { EngineClient } from '../engine-client/engine.client';
import { RunContext } from '../graph/context';
import { CHECKPOINTER } from '../graph/checkpointer';
import {
  OnboardingAnnotation,
  OnboardingState,
  defaultOnboardingState,
  toOnboardingSnapshot,
} from './state';
import { makeProfileCheckNode } from './nodes/profile-check.node';
import { makeProposeThemeNode } from './nodes/propose-theme.node';
import { makeDraftContentNode } from './nodes/draft-content.node';
import { makeAssembleDraftNode } from './nodes/assemble-draft.node';
import { makeDispatchDraftNode } from './nodes/dispatch-draft.node';

export interface OnboardingRunInput {
  threadId: string;
  ctx: Omit<RunContext, 'threadId'>;
  content: string;
}

/**
 * The second graph beside the schema-drafting one: same checkpointer, same
 * per-run compilation (nodes close over the caller's identity without it
 * being written to a checkpoint), different state and different job.
 */
@Injectable()
export class OnboardingGraphService {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(LLM) private readonly llm: LlmProvider,
    private readonly engine: EngineClient,
    @Inject(CHECKPOINTER) private readonly checkpointer: RedisSaver,
  ) {}

  private build(ctx: RunContext) {
    const graph = new StateGraph(OnboardingAnnotation)
      .addNode('profileCheck', makeProfileCheckNode({ llm: this.llm }))
      .addNode(
        'proposeTheme',
        makeProposeThemeNode({ llm: this.llm, maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }),
      )
      .addNode(
        'draftContent',
        makeDraftContentNode({ llm: this.llm, maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }),
      )
      .addNode('assembleDraft', makeAssembleDraftNode())
      .addNode('dispatchDraft', makeDispatchDraftNode({ engine: this.engine }, ctx))
      // A message to a drafted thread is feedback: regenerate with history,
      // profile already known. A fresh or gathering thread starts with it.
      .addConditionalEdges(START, (state: OnboardingState) =>
        state.phase === 'drafted' ? 'proposeTheme' : 'profileCheck',
      )
      .addConditionalEdges('profileCheck', (state: OnboardingState) =>
        state.phase === 'gathering' ? END : 'proposeTheme',
      )
      .addEdge('proposeTheme', 'draftContent')
      .addEdge('draftContent', 'assembleDraft')
      .addEdge('assembleDraft', 'dispatchDraft')
      .addEdge('dispatchDraft', END);

    return graph.compile({ checkpointer: this.checkpointer });
  }

  async run(input: OnboardingRunInput): Promise<OnboardingSnapshot> {
    const app = this.build({ ...input.ctx, threadId: input.threadId });
    const config = { configurable: { thread_id: input.threadId } };

    await app.invoke({ messages: [new HumanMessage(input.content)] }, config);

    return this.snapshot(input.threadId);
  }

  async snapshot(threadId: string): Promise<OnboardingSnapshot> {
    const app = this.build({
      principal: { tenantId: '', userId: '', role: null },
      authToken: '',
      threadId,
    });
    const state = await app.getState({ configurable: { thread_id: threadId } });
    // A never-run thread has no checkpoint: `state.values` is `{}`, so the
    // defaults stand in, exactly as the schema graph's snapshot does.
    return toOnboardingSnapshot(threadId, {
      ...defaultOnboardingState,
      ...(state.values as Partial<OnboardingState>),
    });
  }
}
