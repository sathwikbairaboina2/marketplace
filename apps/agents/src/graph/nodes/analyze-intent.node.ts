import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { DynamicEntityType } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { INTENT_SYSTEM } from '../prompts';

// 'none' rather than a nullable field: small models emit enum members far more
// reliably than they emit JSON null.
const IntentSchema = z.object({
  targetEntity: z.enum(['Product', 'Order', 'Event', 'Booking', 'none']),
  clarification: z.string(),
});

export function makeAnalyzeIntentNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    // A follow-up turn ("make it required") carries no entity of its own.
    // Re-deriving it would trap the conversation in a clarification loop.
    if (state.targetEntity) {
      return { targetEntity: state.targetEntity, phase: 'drafting' };
    }

    const intent = await deps.llm.structured({
      system: INTENT_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: IntentSchema,
      name: 'intent',
    });

    if (intent.targetEntity === 'none') {
      const question = intent.clarification.trim() || 'Which record type should this apply to?';
      return {
        targetEntity: null,
        phase: 'gathering',
        missingRequirements: ['target record type'],
        messages: [new AIMessage(question)],
      };
    }

    return { targetEntity: intent.targetEntity as DynamicEntityType, phase: 'drafting', missingRequirements: [] };
  };
}
