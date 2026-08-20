import { AIMessage } from '@langchain/core/messages';
import { ProblemException } from '../../common/problem';
import { EngineClient } from '../../engine-client/engine.client';
import { RunContext } from '../../graph/context';
import { OnboardingState } from '../state';

export function makeDispatchDraftNode(deps: { engine: EngineClient }, ctx: RunContext) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    if (!state.draft) {
      // Unreachable through the graph's edges; typed rather than a bare Error
      // for the same reason as the schema graph's dispatch node.
      throw new ProblemException(
        'internal-error',
        500,
        'Internal Server Error',
        'dispatch requires an assembled draft',
      );
    }

    // The owner's own token: the engine applies exactly the authority the
    // person in the wizard has, and publishing stays a human HTTP action.
    await deps.engine.putStorefrontDraft(state.draft, ctx.authToken);

    return {
      phase: 'drafted',
      messages: [
        new AIMessage(
          "I've updated your draft store — the preview should refresh. Tell me what to change, or hit Publish when it feels right.",
        ),
      ],
    };
  };
}
