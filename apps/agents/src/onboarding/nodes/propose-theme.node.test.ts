import { makeProposeThemeNode } from './propose-theme.node';
import { defaultOnboardingState } from '../state';

const llm = { structured: jest.fn(), text: jest.fn() };

const state = {
  ...defaultOnboardingState,
  profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
};

beforeEach(() => jest.clearAllMocks());

describe('proposeTheme', () => {
  it('lands a valid pick with its tuning in state', async () => {
    llm.structured.mockResolvedValue({
      presetId: 'artisan',
      accent: '#8a3f1f',
      radiusScale: 'sharp',
    });

    const node = makeProposeThemeNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.presetId).toBe('artisan');
    expect(result.overrides).toEqual({ accent: '#8a3f1f', radiusScale: 'sharp' });
  });

  it('drops a low-contrast accent instead of failing the run', async () => {
    llm.structured.mockResolvedValue({ presetId: 'market', accent: '#ffe94a' });

    const node = makeProposeThemeNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.presetId).toBe('market');
    expect(result.overrides).toEqual({});
  });

  it('retries an invalid preset and succeeds on a later attempt', async () => {
    llm.structured
      .mockResolvedValueOnce({ presetId: 'vaporwave' })
      .mockResolvedValueOnce({ presetId: 'studio' });

    const node = makeProposeThemeNode({ llm, maxAttempts: 3 });
    const result = await node(state);

    expect(result.presetId).toBe('studio');
    expect(llm.structured).toHaveBeenCalledTimes(2);
  });

  it('throws a typed internal error once attempts are exhausted', async () => {
    llm.structured.mockResolvedValue({ presetId: 'vaporwave' });

    const node = makeProposeThemeNode({ llm, maxAttempts: 2 });
    await expect(node(state)).rejects.toMatchObject({ problem: { status: 500 } });
    expect(llm.structured).toHaveBeenCalledTimes(2);
  });
});
