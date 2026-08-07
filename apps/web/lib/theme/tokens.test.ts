import { describe, expect, it } from 'vitest';
import { palette, antdTheme, cssVars } from './tokens';

describe('tokens', () => {
  it('exposes the slate and teal palette', () => {
    expect(palette.primary).toBe('#0d9488');
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

  it('keeps the sidebar dark in both modes', () => {
    // The back-office sidebar is dark by design, not by theme -- flipping it
    // white in light mode would undo the decision the chrome is built on.
    expect(cssVars('light')['--mp-sidebar']).toBe(cssVars('dark')['--mp-sidebar']);
  });
});
