import { describe, expect, it } from 'vitest';
import { palette, antdTheme, cssVars } from './tokens';

describe('tokens', () => {
  it('exposes the slate and teal palette', () => {
    expect(palette.primary).toBe('#0f766e');
    expect(palette.ink).toBe('#0f172a');
  });

  it('builds an ANTD theme whose primary matches the palette in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(antdTheme(mode).token?.colorPrimary).toBe(palette.primary);
    }
  });

  it('selects a different algorithm per mode', () => {
    expect(antdTheme('light').algorithm).not.toBe(antdTheme('dark').algorithm);
  });

  // The whole reason both consumers derive from one object: a value that
  // differs between the ANTD config and the stylesheet is a Button that no
  // longer matches the panel it sits on.
  it('emits CSS variables that agree with the ANTD token', () => {
    const vars = cssVars('light');
    expect(vars['--mp-primary']).toBe(palette.primary);
    expect(vars['--mp-primary']).toBe(antdTheme('light').token?.colorPrimary);
  });

  it('emits a different surface for dark than for light', () => {
    expect(cssVars('dark')['--mp-surface']).not.toBe(cssVars('light')['--mp-surface']);
  });

  it('names every variable with the same prefix', () => {
    for (const key of Object.keys(cssVars('light'))) expect(key.startsWith('--mp-')).toBe(true);
  });

  /**
   * The palette polices its own contrast.
   *
   * These pairs were all failing at once and none of it was visible in review:
   * --mp-primary is a fill with white text on it and measured 3.74:1, and it
   * was simultaneously the colour of every link in the app. A palette that
   * cannot be checked by reading it needs to be checked by running it.
   */
  const luminance = (hex: string) => {
    const channels = (hex.replace('#', '').match(/../g) ?? [])
      .map((pair) => parseInt(pair, 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };

  const contrast = (a: string, b: string) => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
  };

  const AA = 4.5;

  it('keeps white legible on every filled surface', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = cssVars(mode);
      expect(contrast('#ffffff', vars['--mp-primary'])).toBeGreaterThanOrEqual(AA);
    }
  });

  it('keeps body, muted and status text legible on every surface of its theme', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = cssVars(mode);
      const surfaces = ['--mp-surface', '--mp-surface-raised', '--mp-surface-sunken'];
      const inks = [
        '--mp-ink',
        '--mp-ink-soft',
        '--mp-muted',
        '--mp-primary-text',
        '--mp-success',
        '--mp-warning',
        '--mp-danger',
      ];

      for (const ink of inks) {
        for (const surface of surfaces) {
          expect(
            contrast(vars[ink], vars[surface]),
            `${ink} on ${surface} in ${mode}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });

  it('keeps the sidebar legible, which is dark in both themes', () => {
    for (const mode of ['light', 'dark'] as const) {
      const vars = cssVars(mode);
      for (const ink of ['--mp-sidebar-text', '--mp-sidebar-text-strong', '--mp-sidebar-accent']) {
        expect(contrast(vars[ink], vars['--mp-sidebar']), `${ink} in ${mode}`).toBeGreaterThanOrEqual(
          AA,
        );
      }
    }
  });

  it('keeps the sidebar dark in both modes', () => {
    // The back-office sidebar is dark by design, not by theme -- flipping it
    // white in light mode would undo the decision the chrome is built on.
    expect(cssVars('light')['--mp-sidebar']).toBe(cssVars('dark')['--mp-sidebar']);
  });
});

describe('hero and dropdown tokens', () => {
  it('emits hero tokens that differ between themes', () => {
    const light = cssVars('light');
    const dark = cssVars('dark');
    expect(light['--mp-hero-bg']).toBeDefined();
    expect(light['--mp-hero-bg']).not.toBe(dark['--mp-hero-bg']);
    expect(light['--mp-hero-ink']).toBe('#0f172a');
    expect(dark['--mp-hero-ink']).toBe('#ffffff');
  });

  it('themes the Select dropdown from the palette, not ANTD blue', () => {
    const cfg = antdTheme('light');
    expect(cfg.components?.Select?.optionSelectedBg).toBe('rgb(13 148 136 / 10%)');
  });
});
