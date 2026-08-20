import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BusinessProfileSchema, BusinessRequirementsSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { INTERVIEW_SYSTEM } from '../prompts';

/**
 * The ceiling on an adaptive interview. The model decides when it knows
 * enough; this decides when it has had long enough to decide.
 */
export const ASK_MAX = 5;

/**
 * Loose on purpose, like ThemeResultSchema next door: the two nested objects
 * are validated against the real contracts below, where a near-miss costs that
 * slice rather than failing the structured call outright.
 */
const InterviewResultSchema = z.object({
  satisfied: z.boolean(),
  profile: z
    .object({ kind: z.string(), name: z.string(), tone: z.string(), audience: z.string() })
    .nullable(),
  requirements: z
    .object({
      sellsWhat: z.string(),
      categories: z.array(z.string()),
      fulfilment: z.string(),
      priceBand: z.string(),
      differentiator: z.string(),
    })
    .nullable(),
  question: z.string(),
});

export function makeInterviewNode(deps: { llm: LlmProvider; askMax: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // A re-run of the wizard resumes what it learned; the owner is not
    // interrogated twice.
    if (state.profile) return { phase: 'generating' };

    const result = await deps.llm.structured({
      system: INTERVIEW_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: InterviewResultSchema,
      name: 'business_interview',
    });

    const profile = result.profile ? BusinessProfileSchema.safeParse(result.profile) : null;
    const requirements = result.requirements
      ? BusinessRequirementsSchema.safeParse(result.requirements)
      : null;

    // The floor. `satisfied` is worth nothing without a profile that parses:
    // a model that declares victory on "hi" does not get to.
    const grounded = profile?.success === true;
    // The cap, counting the question this turn would ask.
    const atCap = state.questionCount + 1 >= deps.askMax;

    if (grounded && (result.satisfied || atCap)) {
      return {
        phase: 'generating',
        profile: profile.data,
        // Partial requirements stay null: the needs inference builds no plan
        // rather than a plan from half-known facts.
        requirements: requirements?.success ? requirements.data : null,
      };
    }

    const question = result.question.trim() || 'What kind of business are you setting up?';
    return {
      phase: 'gathering',
      questionCount: state.questionCount + 1,
      messages: [new AIMessage(question)],
    };
  };
}
