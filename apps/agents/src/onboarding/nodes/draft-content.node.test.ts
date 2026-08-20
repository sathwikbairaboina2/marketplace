import { makeDraftContentNode } from './draft-content.node';
import { defaultOnboardingState } from '../state';
import type { Banner } from '@marketplace/contracts';

const llm = { structured: jest.fn(), text: jest.fn() };

const state = {
  ...defaultOnboardingState,
  profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
};

const goodContent = {
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      ctaLabel: 'Browse the shelf',
      ctaHref: '/products',
    },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('draftContent', () => {
  it('maps model output onto contract about and banners', async () => {
    llm.structured.mockResolvedValue(goodContent);

    const node = makeDraftContentNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.about?.title).toBe('About Kiln & Loom');
    expect(result.banners).toHaveLength(1);
    expect(result.banners?.[0]).toMatchObject({
      slot: 'hero',
      art: { kind: 'css' },
      cta: { label: 'Browse the shelf', href: '/products' },
    });
  });

  it('coerces an off-allowlist cta href to /products', async () => {
    llm.structured.mockResolvedValue({
      ...goodContent,
      banners: [{ ...goodContent.banners[0], ctaHref: 'https://elsewhere.example' }],
    });

    const node = makeDraftContentNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.banners?.[0].cta.href).toBe('/products');
  });

  it('keeps an existing uploaded image when copy is regenerated for that slot', async () => {
    llm.structured.mockResolvedValue(goodContent);
    const existing: Banner = {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Old words',
      subline: 'Old subline.',
      cta: { label: 'Old', href: '/products' },
      art: { kind: 'upload', imageUrl: 'https://media.local/hero.png' },
    };

    const node = makeDraftContentNode({ llm, maxAttempts: 3 });
    const result = await node({ ...state, banners: [existing] });

    expect(result.banners?.[0].headline).toBe('Objects with a thumbprint');
    expect(result.banners?.[0].art).toEqual({
      kind: 'upload',
      imageUrl: 'https://media.local/hero.png',
    });
  });

  it('retries when no hero banner survives and succeeds on a later attempt', async () => {
    llm.structured
      .mockResolvedValueOnce({ ...goodContent, banners: [] })
      .mockResolvedValueOnce(goodContent);

    const node = makeDraftContentNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.banners).toHaveLength(1);
    expect(llm.structured).toHaveBeenCalledTimes(2);
  });

  it('throws a typed internal error once attempts are exhausted', async () => {
    llm.structured.mockResolvedValue({ ...goodContent, banners: [] });

    const node = makeDraftContentNode({ llm, maxAttempts: 2 });
    await expect(node(state)).rejects.toMatchObject({ problem: { status: 500 } });
  });
});
