import { z } from 'zod';
import {
  AboutPageSchema,
  Banner,
  BannerSchema,
  BannerSlotSchema,
} from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { ProblemException } from '../../common/problem';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { CONTENT_SYSTEM } from '../prompts';

const CTA_ALLOWLIST = new Set(['/products', '/events', '/about']);

/** Loose for the same reason as ThemeResultSchema: contracts validate below. */
const ContentResultSchema = z.object({
  about: z.object({
    title: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  }),
  banners: z.array(
    z.object({
      slot: z.string(),
      headline: z.string(),
      subline: z.string(),
      ctaLabel: z.string(),
      ctaHref: z.string(),
    }),
  ),
});

export function makeDraftContentNode(deps: { llm: LlmProvider; maxAttempts: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    const profileText = JSON.stringify(state.profile);

    for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
      const result = await deps.llm.structured({
        system: `${CONTENT_SYSTEM}\n\nBusiness: ${profileText}`,
        messages: toChatMessages(state.messages),
        schema: ContentResultSchema,
        name: 'storefront_content',
      });

      const about = AboutPageSchema.safeParse(result.about);
      if (!about.success) continue;

      const seen = new Set<string>();
      const banners: Banner[] = [];
      for (const raw of result.banners) {
        const slot = BannerSlotSchema.safeParse(raw.slot);
        if (!slot.success || seen.has(slot.data)) continue;
        // Feedback on copy must not throw away the owner's image: a slot that
        // already carries uploaded or generated art keeps it through a rewrite.
        const existingArt = state.banners?.find(
          (b) => b.slot === slot.data && b.art.kind !== 'css',
        )?.art;
        const banner = BannerSchema.safeParse({
          id: `${slot.data}-1`,
          slot: slot.data,
          headline: raw.headline,
          subline: raw.subline,
          cta: {
            label: raw.ctaLabel,
            href: CTA_ALLOWLIST.has(raw.ctaHref) ? raw.ctaHref : '/products',
          },
          art: existingArt ?? { kind: 'css' },
        });
        if (!banner.success) continue;
        seen.add(slot.data);
        banners.push(banner.data);
      }

      // A storefront without a hero is not a draft worth showing.
      if (!banners.some((b) => b.slot === 'hero')) continue;

      return { about: about.data, banners };
    }

    throw new ProblemException(
      'internal-error',
      500,
      'Internal Server Error',
      'content drafting never produced a valid about page with a hero banner',
    );
  };
}
