import { StorefrontConfigSchema } from '@marketplace/contracts';
import { ProblemException } from '../../common/problem';
import { OnboardingState } from '../state';

/**
 * Pure: no model, no I/O. Upstream nodes validated their slices, so a failure
 * here is a bug in this graph -- and a typed 500 beats a stored corrupt draft.
 */
export function makeAssembleDraftNode() {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    const parsed = StorefrontConfigSchema.safeParse({
      presetId: state.presetId,
      overrides: state.overrides ?? {},
      about: state.about,
      banners: state.banners ?? [],
      businessProfile: state.profile,
    });

    if (!parsed.success) {
      throw new ProblemException(
        'internal-error',
        500,
        'Internal Server Error',
        'assembled draft failed contract validation',
      );
    }

    return { draft: parsed.data };
  };
}
