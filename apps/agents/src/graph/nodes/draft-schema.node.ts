import { z } from 'zod';
import { BlueprintDiff, FieldTypeSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { DRAFT_SYSTEM } from '../prompts';

// Not BlueprintDiffSchema directly: its `default: unknown().nullable()` has no
// useful JSON-schema form for a constrained decode, and `.strict()` adds an
// additionalProperties rule small models handle poorly. The narrow shape is
// widened to the real contract below, where the defaults come from.
const DraftSchema = z.object({
  addedFields: z
    .array(z.object({ name: z.string(), type: FieldTypeSchema, required: z.boolean() }))
    .min(1),
});

export function makeDraftSchemaNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const corrections =
      state.validationErrors.length > 0
        ? `\n\nThe previous attempt was rejected for these reasons:\n- ${state.validationErrors.join('\n- ')}`
        : '';

    const draft = await deps.llm.structured({
      system: `${DRAFT_SYSTEM}\n\nRecord type: ${state.targetEntity}${corrections}`,
      messages: toChatMessages(state.messages),
      schema: DraftSchema,
      name: 'blueprint_diff',
    });

    const draftPayload: BlueprintDiff = {
      addedFields: draft.addedFields.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        default: null,
      })),
    };

    return { draftPayload, phase: 'validating', draftAttempts: state.draftAttempts + 1 };
  };
}
