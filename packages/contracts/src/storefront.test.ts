import {
  ApplySetupPlanRequestSchema,
  BannerArtRequestSchema,
  BannerSchema,
  BusinessRequirementsSchema,
  FieldProposalSchema,
  SetupPlanSchema,
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

const plan = {
  sellsWhat: 'bookable',
  categories: ['classes', 'retreats'],
  fields: [
    {
      entity: 'Event',
      field: { name: 'durationMinutes', type: 'number', required: false, default: null },
      rationale: 'classes vary in length',
    },
  ],
};

describe('BusinessRequirementsSchema', () => {
  const requirements = {
    sellsWhat: 'goods',
    categories: ['mugs'],
    fulfilment: 'ship nationwide',
    priceBand: 'mid',
    differentiator: 'hand-thrown',
  };

  it('accepts a complete set', () => {
    expect(BusinessRequirementsSchema.safeParse(requirements).success).toBe(true);
  });

  it('rejects more than eight categories', () => {
    const categories = Array.from({ length: 9 }, (_, i) => `c${i}`);
    expect(BusinessRequirementsSchema.safeParse({ ...requirements, categories }).success).toBe(
      false,
    );
  });

  it('rejects an unknown sellsWhat', () => {
    expect(
      BusinessRequirementsSchema.safeParse({ ...requirements, sellsWhat: 'services' }).success,
    ).toBe(false);
  });
});

describe('FieldProposalSchema', () => {
  it('rejects a reserved core field name for the entity', () => {
    const result = FieldProposalSchema.safeParse({
      entity: 'Product',
      field: { name: 'priceMinor', type: 'number', required: false, default: null },
      rationale: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the same name on an entity that does not reserve it', () => {
    const result = FieldProposalSchema.safeParse({
      entity: 'Product',
      field: { name: 'capacity', type: 'number', required: false, default: null },
      rationale: 'containers have a capacity',
    });
    expect(result.success).toBe(true);
  });
});

describe('SetupPlanSchema', () => {
  it('accepts a plan within the caps', () => {
    expect(SetupPlanSchema.parse(plan).fields).toHaveLength(1);
  });

  it('rejects more than six field proposals', () => {
    const fields = Array.from({ length: 7 }, (_, i) => ({
      entity: 'Product',
      field: { name: `extra${i}`, type: 'string', required: false, default: null },
      rationale: 'x',
    }));
    expect(SetupPlanSchema.safeParse({ ...plan, fields }).success).toBe(false);
  });
});

describe('StorefrontConfigSchema with the new keys', () => {
  it('parses a draft written before the keys existed', () => {
    expect(StorefrontConfigSchema.safeParse(validConfig).success).toBe(true);
  });

  it('parses a draft carrying them', () => {
    const parsed = StorefrontConfigSchema.parse({
      ...validConfig,
      sellsWhat: 'goods',
      categories: ['mugs'],
    });
    expect(parsed.categories).toEqual(['mugs']);
  });
});

describe('ApplySetupPlanRequestSchema', () => {
  it('re-refuses a reserved field name the plan never proposed', () => {
    const result = ApplySetupPlanRequestSchema.safeParse({
      sellsWhat: 'goods',
      categories: [],
      fields: [
        {
          entity: 'Product',
          field: { name: 'priceMinor', type: 'number', required: false, default: null },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a legitimate subset', () => {
    const result = ApplySetupPlanRequestSchema.safeParse({
      sellsWhat: 'bookable',
      categories: ['classes'],
      fields: [
        {
          entity: 'Event',
          field: { name: 'durationMinutes', type: 'number', required: false, default: null },
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});
