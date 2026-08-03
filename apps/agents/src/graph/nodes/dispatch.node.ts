import { AIMessage } from '@langchain/core/messages';
import { DispatchService } from '../../dispatch/dispatch.service';
import { RunContext } from '../context';
import { AgentState } from '../state';

export function makeDispatchNode(deps: { dispatch: DispatchService }, ctx: RunContext) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.draftPayload || !state.targetEntity) {
      throw new Error('dispatch requires a validated draft');
    }

    // Already sent: a duplicate confirm must not produce a second proposal.
    if (state.dispatchedMessageId) {
      return { phase: 'done' };
    }

    const messageId = await deps.dispatch.dispatch({
      threadId: ctx.threadId,
      tenantId: ctx.principal.tenantId,
      targetEntity: state.targetEntity,
      payload: state.draftPayload,
    });

    return {
      phase: 'done',
      dispatchedMessageId: messageId,
      messages: [
        new AIMessage(
          'Sent for approval. It will appear as a proposed change that an administrator can apply.',
        ),
      ],
    };
  };
}
