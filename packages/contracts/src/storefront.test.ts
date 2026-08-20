import {
  BannerArtRequestSchema,
  BannerSchema,
  contrastRatio,
  PRESET_IDS,
  PRESET_SURFACES,
  StorefrontConfigSchema,
  ThemeOverridesSchema,
} from './storefront';

const validConfig = {
  presetId: 'artisan',
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      cta: { label: 'Browse the shelf', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: {
    kind: 'ceramics studio',
    name: 'Kiln & Loom',
    tone: 'warm, personal',
    audience: 'gift shoppers',
  },
};

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0f766e', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#0f766e'),
      5,
    );
  });
});

describe('PRESET_SURFACES', () => {
  it('covers every preset id with light and dark hex surfaces', () => {
    for (const id of PRESET_IDS) {
      expect(PRESET_SURFACES[id].light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(PRESET_SURFACES[id].dark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('ThemeOverridesSchema', () => {
  it('accepts an accent white text can sit on', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#0f766e' }).success).toBe(true);
  });

  it('rejects an accent too light for white text (fill rule, 4.5:1)', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#ffe94a' }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#0f766e', spacing: 2 }).success).toBe(false);
  });
});

describe('BannerSchema', () => {
  it('rejects a generated banner without an imageUrl', () => {
    const banner = { ...validConfig.banners[0], art: { kind: 'generated' } };
    expect(BannerSchema.safeParse(banner).success).toBe(false);
  });
});

describe('BannerArtRequestSchema', () => {
  it('accepts a known slot and nothing else', () => {
    expect(BannerArtRequestSchema.safeParse({ slot: 'hero' }).success).toBe(true);
    expect(BannerArtRequestSchema.safeParse({ slot: 'sidebar' }).success).toBe(false);
    expect(BannerArtRequestSchema.safeParse({ slot: 'hero', prompt: 'x' }).success).toBe(false);
  });
});

describe('StorefrontConfigSchema', () => {
  it('accepts the reference config', () => {
    expect(StorefrontConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it('rejects two banners in one slot', () => {
    const twice = {
      ...validConfig,
      banners: [validConfig.banners[0], { ...validConfig.banners[0], id: 'hero-2' }],
    };
    expect(StorefrontConfigSchema.safeParse(twice).success).toBe(false);
  });

  it('rejects a fourth banner', () => {
    const four = {
      ...validConfig,
      banners: ['hero', 'mid', 'footer', 'hero'].map((slot, i) => ({
        ...validConfig.banners[0],
        id: `b-${i}`,
        slot,
      })),
    };
    expect(StorefrontConfigSchema.safeParse(four).success).toBe(false);
  });

  it('rejects more than six about sections', () => {
    const s = { heading: 'h', body: 'b' };
    const many = { ...validConfig, about: { title: 't', sections: Array(7).fill(s) } };
    expect(StorefrontConfigSchema.safeParse(many).success).toBe(false);
  });
});
