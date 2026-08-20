import { z } from 'zod';

export const PRESET_IDS = ['artisan', 'tech', 'editorial', 'market', 'studio'] as const;
export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

export const RADIUS_SCALES = ['sharp', 'soft', 'round'] as const;
export const RadiusScaleSchema = z.enum(RADIUS_SCALES);
export type RadiusScale = z.infer<typeof RadiusScaleSchema>;

export const FONT_PAIRINGS = ['inter', 'fraunces', 'playfair', 'nunito'] as const;
export const FontPairingSchema = z.enum(FONT_PAIRINGS);
export type FontPairing = z.infer<typeof FontPairingSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be #rrggbb');

/**
 * WCAG 2.x relative-luminance contrast. Lives in contracts because the accent
 * refinement below needs it on every write path -- engine, agents and web all
 * validate with the same function, so "the agent cannot store an unreadable
 * colour" is a property of the schema, not of any one service.
 */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * channel((n >> 16) & 0xff) +
      0.7152 * channel((n >> 8) & 0xff) +
      0.0722 * channel(n & 0xff)
    );
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The base page surface of each preset, light and dark. The one slice of the
 * presets that lives in contracts: web's presets.ts imports these values for
 * its surfaces so validation and rendering cannot drift.
 */
export const PRESET_SURFACES: Record<PresetId, { light: string; dark: string }> = {
  artisan: { light: '#faf6ef', dark: '#171310' },
  tech: { light: '#f5f7fb', dark: '#0a0e17' },
  editorial: { light: '#ffffff', dark: '#101010' },
  market: { light: '#fffdf7', dark: '#12160e' },
  studio: { light: '#f6f5f3', dark: '#161512' },
};

/**
 * The accent is a *fill*: primary buttons paint it with white text, so white
 * on accent must clear 4.5:1. Whether it can also serve as text on a given
 * surface is decided at resolve time (web falls back to the preset's own text
 * accent when it cannot) -- a single hex cannot clear both modes' surfaces as
 * text, and demanding it would reject nearly every reasonable colour.
 */
export const ThemeOverridesSchema = z
  .object({
    accent: HexColorSchema.optional(),
    radiusScale: RadiusScaleSchema.optional(),
    fontPairing: FontPairingSchema.optional(),
    heroStyle: z.enum(['gradient', 'image']).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.accent && contrastRatio('#ffffff', val.accent) < 4.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accent'],
        message: 'accent must keep white text at 4.5:1 or better',
      });
    }
  });
export type ThemeOverrides = z.infer<typeof ThemeOverridesSchema>;

export const BANNER_SLOTS = ['hero', 'mid', 'footer'] as const;
export const BannerSlotSchema = z.enum(BANNER_SLOTS);
export type BannerSlot = z.infer<typeof BannerSlotSchema>;

const BannerArtSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('css') }).strict(),
  z.object({ kind: z.literal('upload'), imageUrl: z.string().url() }).strict(),
  z.object({ kind: z.literal('generated'), imageUrl: z.string().url() }).strict(),
]);

export const BannerSchema = z
  .object({
    id: z.string().min(1).max(40),
    slot: BannerSlotSchema,
    headline: z.string().trim().min(1).max(80),
    subline: z.string().trim().min(1).max(160),
    cta: z
      .object({
        label: z.string().trim().min(1).max(30),
        href: z.string().min(1).max(200),
      })
      .strict(),
    art: BannerArtSchema,
  })
  .strict();
export type Banner = z.infer<typeof BannerSchema>;

export const AboutPageSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(80),
            body: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type AboutPage = z.infer<typeof AboutPageSchema>;

export const BusinessProfileSchema = z
  .object({
    kind: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    tone: z.string().trim().min(1).max(200),
    audience: z.string().trim().min(1).max(200),
  })
  .strict();
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const StorefrontConfigSchema = z
  .object({
    presetId: PresetIdSchema,
    overrides: ThemeOverridesSchema,
    about: AboutPageSchema,
    banners: z.array(BannerSchema).max(3),
    businessProfile: BusinessProfileSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const slots = val.banners.map((b) => b.slot);
    if (new Set(slots).size !== slots.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['banners'],
        message: 'at most one banner per slot',
      });
    }
  });
export type StorefrontConfig = z.infer<typeof StorefrontConfigSchema>;

/**
 * GET /storefront: the published config, in an envelope. The envelope exists
 * because "no config" must travel as real JSON -- a bare `null` return
 * serializes to an empty 200 body, which every JSON parse then rejects.
 */
export const StorefrontPublicResponseSchema = z.object({
  config: StorefrontConfigSchema.nullable(),
});
export type StorefrontPublicResponse = z.infer<typeof StorefrontPublicResponseSchema>;

/** GET /storefront/draft: the draft plus what this deployment can do. */
export const StorefrontDraftResponseSchema = z.object({
  draft: StorefrontConfigSchema.nullable(),
  capabilities: z.object({ imageGen: z.boolean() }),
});
export type StorefrontDraftResponse = z.infer<typeof StorefrontDraftResponseSchema>;

/** The owner's "don't show me the wizard again" flag. */
export const OnboardingFlagSchema = z.object({ dismissed: z.boolean() }).strict();
export type OnboardingFlag = z.infer<typeof OnboardingFlagSchema>;

/**
 * POST /storefront/banner-art: generate art for one slot of the draft. The
 * prompt is built server-side from the draft's business profile and that
 * slot's copy -- the client names the slot and nothing else.
 */
export const BannerArtRequestSchema = z.object({ slot: BannerSlotSchema }).strict();
export type BannerArtRequest = z.infer<typeof BannerArtRequestSchema>;

export const BannerArtResponseSchema = z.object({ imageUrl: z.string().url() }).strict();
export type BannerArtResponse = z.infer<typeof BannerArtResponseSchema>;
