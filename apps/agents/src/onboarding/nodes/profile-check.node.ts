import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BusinessProfileSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { PROFILE_SYSTEM } from '../prompts';

const ProfileResultSchema = z.object({
  complete: z.boolean(),
  profile: z
    .object({ kind: z.string(), name: z.string(), tone: z.string(), audience: z.string() })
    .nullable(),
  question: z.string(),
});

export function makeProfileCheckNode(deps: { llm: LlmProvider }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // A re-run of the wizard resumes what it learned; the owner is not
    // interrogated twice.
    if (state.profile) return { phase: 'generating' };

    const result = await deps.llm.structured({
      system: PROFILE_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: ProfileResultSchema,
      name: 'business_profile',
    });

    const parsed =
      result.complete && result.profile ? BusinessProfileSchema.safeParse(result.profile) : null;
    if (parsed?.success) {
      return { phase: 'generating', profile: parsed.data };
    }

    const question = result.question.trim() || 'What kind of business are you setting up?';
    return { phase: 'gathering', messages: [new AIMessage(question)] };
  };
}
