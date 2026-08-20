import { z } from 'zod';
import { PresetIdSchema, ThemeOverridesSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { ProblemException } from '../../common/problem';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { THEME_SYSTEM } from '../prompts';

/**
 * Loose on purpose: the model's output is validated against the real contracts
 * enums below, where an invalid preset retries and an invalid override is
 * dropped. Encoding the enums here would make the structured call itself fail
 * on a near-miss, which the bounded retry handles better.
 */
const ThemeResultSchema = z.object({
  presetId: z.string(),
  accent: z.string().optional(),
  radiusScale: z.string().optional(),
  fontPairing: z.string().optional(),
});

export function makeProposeThemeNode(deps: { llm: LlmProvider; maxAttempts: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    const profileText = JSON.stringify(state.profile);

    for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
      const result = await deps.llm.structured({
        system: `${THEME_SYSTEM}\n\nBusiness: ${profileText}`,
        messages: toChatMessages(state.messages),
        schema: ThemeResultSchema,
        name: 'theme_choice',
      });

      const preset = PresetIdSchema.safeParse(result.presetId);
      if (!preset.success) continue;

      const overrides = ThemeOverridesSchema.safeParse({
        ...(result.accent ? { accent: result.accent } : {}),
        ...(result.radiusScale ? { radiusScale: result.radiusScale } : {}),
        ...(result.fontPairing ? { fontPairing: result.fontPairing } : {}),
      });

      return {
        presetId: preset.data,
        // A malformed override set costs the tuning, never the run.
        overrides: overrides.success ? overrides.data : {},
      };
    }

    throw new ProblemException(
      'internal-error',
      500,
      'Internal Server Error',
      'theme proposal never named a valid preset',
    );
  };
}
