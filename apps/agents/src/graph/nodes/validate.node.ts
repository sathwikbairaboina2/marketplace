import { AIMessage } from '@langchain/core/messages';
import { BlueprintDiffSchema } from '@marketplace/contracts';
import { AgentState } from '../state';
import { CORE_FIELDS } from '../core-fields';

function describeDiff(state: AgentState): string {
  const fields = state.draftPayload?.addedFields ?? [];
  return fields.map((f) => `${f.name} (${f.type}${f.required ? ', required' : ''})`).join(', ');
}

// `validationErrors` is narrowed to always-present here (every branch below sets it): the
// plain `Partial<AgentState>` of the other nodes would leave it optional, and callers --
// this node's own tests included -- always index into it right after a rejection.
type ValidateResult = Partial<AgentState> & { validationErrors: string[] };

export function makeValidateNode(deps: { maxAttempts: number }) {
  return async (state: AgentState): Promise<ValidateResult> => {
    const errors: string[] = [];

    const parsed = BlueprintDiffSchema.safeParse(state.draftPayload);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((i) => `${i.path.join('.') || 'diff'}: ${i.message}`));
    } else {
      const existing = state.registrySnapshot?.fields ?? {};
      const core = state.targetEntity ? CORE_FIELDS[state.targetEntity] : [];

      for (const field of parsed.data.addedFields) {
        if (field.name in existing) {
          errors.push(`${field.name} already exists on ${state.targetEntity}`);
        }
        if (core.includes(field.name)) {
          errors.push(`${field.name} collides with a built-in field of ${state.targetEntity}`);
        }
      }
    }

    if (errors.length === 0) {
      return {
        phase: 'awaiting_confirmation',
        validationErrors: [],
        messages: [
          new AIMessage(
            `Ready to propose adding ${describeDiff(state)} to ${state.targetEntity}. Confirm to send it for approval.`,
          ),
        ],
      };
    }

    // The bound is what turns "loop back to drafting" from a hang into an answer.
    if (state.draftAttempts >= deps.maxAttempts) {
      return {
        phase: 'gathering',
        draftPayload: null,
        draftAttempts: 0,
        validationErrors: errors,
        messages: [
          new AIMessage(
            `I could not produce a valid change after ${deps.maxAttempts} attempts: ${errors.join('; ')}. Could you restate what you need?`,
          ),
        ],
      };
    }

    return { phase: 'drafting', validationErrors: errors };
  };
}
