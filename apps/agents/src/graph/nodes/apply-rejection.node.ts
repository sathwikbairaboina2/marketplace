import { AIMessage } from '@langchain/core/messages';
import { AgentState } from '../state';

export function makeApplyRejectionNode() {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const last = state.messages[state.messages.length - 1];
    const hasNotes = last?.getType() === 'human';

    if (!hasNotes) {
      return {
        phase: 'done',
        draftPayload: null,
        draftAttempts: 0,
        validationErrors: [],
        messages: [new AIMessage('Discarded. Nothing was sent.')],
      };
    }

    return {
      phase: 'gathering',
      draftPayload: null,
      draftAttempts: 0,
      validationErrors: [],
    };
  };
}
