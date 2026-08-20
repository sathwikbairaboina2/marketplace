import { z } from 'zod';
import { FieldProposalSchema, SellsWhatSchema, SetupPlanSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { NEEDS_SYSTEM } from '../prompts';

/** Loose, like the other generative nodes: validated against the contracts below. */
const NeedsResultSchema = z.object({
  sellsWhat: z.string(),
  categories: z.array(z.string()),
  fields: z.array(
    z.object({
      entity: z.string(),
      field: z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().optional(),
        default: z.unknown().nullable().optional(),
      }),
      rationale: z.string().optional(),
    }),
  ),
});

export function makeInferNeedsNode(deps: { llm: LlmProvider; maxAttempts: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // No requirements means the interview hit its cap without completing them.
    // The storefront still drafts; there is simply nothing to propose.
    if (!state.requirements) return { setupPlan: null };

    const requirements = state.requirements;
    const context = JSON.stringify({ profile: state.profile, requirements });

    for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
      let result: z.infer<typeof NeedsResultSchema>;
      try {
        result = await deps.llm.structured({
          system: `${NEEDS_SYSTEM}\n\nBusiness: ${context}`,
          messages: toChatMessages(state.messages),
          schema: NeedsResultSchema,
          name: 'setup_plan',
        });
      } catch {
        // A malformed envelope costs the attempt, not the run.
        continue;
      }

      // Per-proposal, not all-or-nothing: one bad field name must not cost the
      // owner their whole plan.
      const fields = result.fields
        .map((raw) =>
          FieldProposalSchema.safeParse({
            entity: raw.entity,
            field: {
              name: raw.field.name,
              type: raw.field.type,
              required: raw.field.required ?? false,
              default: raw.field.default ?? null,
            },
            rationale: (raw.rationale ?? '').slice(0, 200),
          }),
        )
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
        .slice(0, 6);

      const sellsWhat = SellsWhatSchema.safeParse(result.sellsWhat);

      const plan = SetupPlanSchema.safeParse({
        // The owner's own answer wins over a model that contradicts it.
        sellsWhat: sellsWhat.success ? sellsWhat.data : requirements.sellsWhat,
        categories: (result.categories.length ? result.categories : requirements.categories)
          .map((category) => category.trim())
          .filter(Boolean)
          .slice(0, 8),
        fields,
      });

      if (plan.success) return { setupPlan: plan.data };
    }

    // A plan is a bonus, not the run: the storefront draft still ships.
    return { setupPlan: null };
  };
}
