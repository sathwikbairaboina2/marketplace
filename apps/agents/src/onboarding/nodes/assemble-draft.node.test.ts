import { makeAssembleDraftNode } from './assemble-draft.node';
import { defaultOnboardingState } from '../state';

const slices = {
  profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
  presetId: 'artisan' as const,
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero' as const,
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      cta: { label: 'Browse the shelf', href: '/products' },
      art: { kind: 'css' as const },
    },
  ],
};

describe('assembleDraft', () => {
  it('composes the slices into a valid config', async () => {
    const node = makeAssembleDraftNode();
    const result = await node({ ...defaultOnboardingState, ...slices });

    expect(result.draft).toMatchObject({
      presetId: 'artisan',
      businessProfile: slices.profile,
      about: slices.about,
    });
  });

  it('throws a typed internal error when a slice is missing', async () => {
    const node = makeAssembleDraftNode();
    await expect(
      node({ ...defaultOnboardingState, ...slices, profile: null }),
    ).rejects.toMatchObject({ problem: { status: 500 } });
  });
});
