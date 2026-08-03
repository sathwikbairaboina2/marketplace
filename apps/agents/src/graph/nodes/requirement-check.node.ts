import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { REQUIREMENT_SYSTEM } from '../prompts';

const RequirementSchema = z.object({
  satisfied: z.boolean(),
  missing: z.array(z.string()),
  question: z.string(),
});

function describeRegistry(state: AgentState): string {
  const fields = state.registrySnapshot?.fields ?? {};
  const names = Object.entries(fields).map(([name, def]) => `${name}: ${def.type}`);
  return names.length > 0 ? names.join(', ') : 'none';
}

export function makeRequirementCheckNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await deps.llm.structured({
      system: `${REQUIREMENT_SYSTEM}\n\nRecord type: ${state.targetEntity}\nExisting fields: ${describeRegistry(state)}`,
      messages: toChatMessages(state.messages),
      schema: RequirementSchema,
      name: 'requirements',
    });

    if (result.satisfied) {
      return { phase: 'drafting', missingRequirements: [] };
    }

    const question = result.question.trim() || 'Could you give the field name and its data type?';
    return {
      phase: 'gathering',
      missingRequirements: result.missing,
      messages: [new AIMessage(question)],
    };
  };
}
