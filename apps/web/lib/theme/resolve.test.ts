import { describe, expect, it } from 'vitest';
import { PRESET_IDS, PRESET_SURFACES, contrastRatio } from '@marketplace/contracts';
import { cssVars } from './tokens';
import { PRESETS } from './presets';
import { resolveTheme } from './resolve';

const baseConfig = (presetId: (typeof PRESET_IDS)[number]) => ({
  presetId,
  overrides: {},
  about: { title: 't', sections: [{ heading: 'h', body: 'b' }] },
  banners: [],
  businessProfile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
});

describe('resolveTheme', () => {
  it('null config is byte-identical to the default cssVars, both modes', () => {
    expect(resolveTheme(null, 'light')).toEqual({
      ...cssVars('light'),
      '--mp-font-heading': expect.any(String),
      '--mp-font-body': expect.any(String),
    });
    expect(resolveTheme(null, 'dark')['--mp-surface']).toBe(cssVars('dark')['--mp-surface']);
  });

  it('every preset emits the full default key set in both modes', () => {
    const keys = Object.keys(resolveTheme(null, 'light')).sort();
    for (const id of PRESET_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(resolveTheme(baseConfig(id), mode)).sort()).toEqual(keys);
      }
    }
  });

  it('preset surfaces match the contracts validation surfaces', () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].light.surface).toBe(PRESET_SURFACES[id].light);
      expect(PRESETS[id].dark.surface).toBe(PRESET_SURFACES[id].dark);
    }
  });

  it('every preset ink and muted clear 4.5:1 on their own surface, both modes', () => {
    for (const id of PRESET_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const p = PRESETS[id][mode];
        expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('every preset accent text clears 4.5:1 on its surface, both modes', () => {
    for (const id of PRESET_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        expect(
          contrastRatio(PRESETS[id].accentText[mode], PRESETS[id][mode].surface),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('an accent override that cannot serve as text falls back to the preset accent text', () => {
    const config = {
      ...baseConfig('editorial'),
      overrides: { accent: '#b91c1c' },
    };
    const vars = resolveTheme(config, 'dark');
    const surface = PRESETS.editorial.dark.surface;
    expect(contrastRatio(vars['--mp-primary-text'], surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('a readable accent override is used as both fill and text', () => {
    const config = { ...baseConfig('artisan'), overrides: { accent: '#155e75' } };
    const vars = resolveTheme(config, 'light');
    expect(vars['--mp-primary']).toBe('#155e75');
    expect(vars['--mp-primary-text']).toBe('#155e75');
  });

  it('radius override changes the radius vars', () => {
    const vars = resolveTheme(
      { ...baseConfig('artisan'), overrides: { radiusScale: 'sharp' } },
      'light',
    );
    expect(vars['--mp-radius-md']).toBe('4px');
  });

  it('font pairing override changes the font vars', () => {
    const vars = resolveTheme(
      { ...baseConfig('tech'), overrides: { fontPairing: 'playfair' } },
      'light',
    );
    expect(vars['--mp-font-heading']).toContain('--font-playfair');
  });
});
