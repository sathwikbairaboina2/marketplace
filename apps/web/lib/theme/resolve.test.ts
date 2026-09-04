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
        // A superset, not an equality: a preset also emits `--mp-text-display`,
        // the step above the ladder's ceiling, which the default palette
        // deliberately does not have -- the CSS falls back to `--mp-text-xxl`
        // when a shop has no preset. Nothing may go *missing*, which is what
        // this test exists to catch.
        expect(Object.keys(resolveTheme(baseConfig(id), mode)).sort()).toEqual(
          expect.arrayContaining(keys),
        );
      }
    }
  });

  it('a preset adds the display step and nothing else beyond the defaults', () => {
    const keys = new Set(Object.keys(resolveTheme(null, 'light')));
    for (const id of PRESET_IDS) {
      const extra = Object.keys(resolveTheme(baseConfig(id), 'light')).filter((k) => !keys.has(k));
      expect(extra).toEqual(['--mp-text-display']);
    }
  });

  it('gives each preset its own rhythm and ladder', () => {
    // Five colourways were not five presets: the spacing scale and the type
    // ladder were emitted once for the whole app and never overridden, so
    // `artisan` and `editorial` rendered the same page to the pixel.
    const spacings = new Set(
      PRESET_IDS.map((id) => resolveTheme(baseConfig(id), 'light')['--mp-space-6']),
    );
    const displays = new Set(
      PRESET_IDS.map((id) => resolveTheme(baseConfig(id), 'light')['--mp-text-display']),
    );
    expect(spacings.size).toBeGreaterThan(1);
    expect(displays.size).toBeGreaterThan(1);
  });

  it('holds the shop body size at 16px whatever the preset', () => {
    // 14px is the cockpit's size. Every preset scales its headings; none of
    // them shrinks the text a shopper reads on a phone.
    for (const id of PRESET_IDS) {
      expect(resolveTheme(baseConfig(id), 'light')['--mp-text-md']).toBe('16px');
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
