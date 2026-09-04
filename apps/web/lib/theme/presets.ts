import type { FontPairing, PresetId, RadiusScale } from '@marketplace/contracts';

/**
 * The five wizard presets. Code, not data: the database stores a preset id and
 * bounded overrides, never palettes, so a colour fix here ships without a
 * migration. Each `surface` value is pinned to `PRESET_SURFACES` in contracts
 * by a test in resolve.test.ts -- that record is what the accent validation
 * refines against, and the two must not drift.
 */
export interface PresetPalette {
  primary: string;
  primaryHover: string;
  primaryDeep: string;
  ink: string;
  inkSoft: string;
  muted: string;
  line: string;
  lineStrong: string;
  surface: string;
  surfaceRaised: string;
  surfaceSunken: string;
  success: string;
  warning: string;
  danger: string;
}

export const FONT_STACKS: Record<FontPairing, { heading: string; body: string }> = {
  inter: {
    heading: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  fraunces: {
    heading: 'var(--font-fraunces), Georgia, serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  playfair: {
    heading: 'var(--font-playfair), Georgia, serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  nunito: {
    heading: 'var(--font-nunito), ui-rounded, ui-sans-serif, sans-serif',
    body: 'var(--font-nunito), ui-rounded, ui-sans-serif, sans-serif',
  },
};

export const RADIUS_VALUES: Record<RadiusScale, { sm: number; md: number; lg: number; xl: number }> = {
  sharp: { sm: 2, md: 4, lg: 6, xl: 8 },
  // `soft` is today's tokens.ts radius scale, so a preset that defaults soft
  // renders the rounding the storefront always had.
  soft: { sm: 6, md: 10, lg: 14, xl: 20 },
  round: { sm: 10, md: 14, lg: 20, xl: 28 },
};

export interface Preset {
  id: PresetId;
  light: PresetPalette;
  dark: PresetPalette;
  /** Accent-as-text per mode, pre-checked against the mode's surface. */
  accentText: { light: string; dark: string };
  /** CSS background value for the hero band. */
  heroBg: { light: string; dark: string };
  defaultRadius: RadiusScale;
  defaultFontPairing: FontPairing;
  /**
   * How much air the shop is given, and how far its headings are allowed to
   * rise above its body text. Without these the five presets were five
   * colourways: the same measure, the same gaps and the same type ladder, so
   * `studio` and `market` — meant to be different densities — had no way to
   * ask for one.
   *
   * `density` multiplies the spacing scale; `typeScale` multiplies the sizes
   * above the body; `display` is the step a hero and a page title get, which
   * a 32px ceiling denied them entirely.
   */
  density: number;
  typeScale: number;
  display: number;
}

export const PRESETS: Record<PresetId, Preset> = {
  artisan: {
    id: 'artisan',
    light: {
      primary: '#a34c26', primaryHover: '#8a3f1f', primaryDeep: '#6f3319',
      ink: '#3d2f24', inkSoft: '#5c4a3a', muted: '#6e5943',
      line: '#e6dcc9', lineStrong: '#d4c5a9',
      surface: '#faf6ef', surfaceRaised: '#ffffff', surfaceSunken: '#f3ead9',
      success: '#3f6d3a', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#a34c26', primaryHover: '#c05f33', primaryDeep: '#8a3f1f',
      ink: '#efe6da', inkSoft: '#d4c5b2', muted: '#ab967f',
      line: '#332a21', lineStrong: '#463a2d',
      surface: '#171310', surfaceRaised: '#211b16', surfaceSunken: '#1b1612',
      success: '#7fb377', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#9a4620', dark: '#e08a5e' },
    heroBg: {
      light: 'linear-gradient(120deg, #f3ead9 0%, #faf6ef 100%)',
      dark: 'linear-gradient(120deg, #211b16 0%, #171310 100%)',
    },
    defaultRadius: 'sharp',
    defaultFontPairing: 'fraunces',
    density: 1.05,
    typeScale: 1.06,
    display: 44,
  },
  tech: {
    id: 'tech',
    light: {
      primary: '#2f5fe0', primaryHover: '#274fc0', primaryDeep: '#1f3f9a',
      ink: '#101828', inkSoft: '#2c3a51', muted: '#54667f',
      line: '#dde4ef', lineStrong: '#c4cfe0',
      surface: '#f5f7fb', surfaceRaised: '#ffffff', surfaceSunken: '#eaeef7',
      success: '#0f766e', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#2f5fe0', primaryHover: '#4f7cff', primaryDeep: '#274fc0',
      ink: '#e8edf5', inkSoft: '#c0cadb', muted: '#8b98ad',
      line: '#1c2436', lineStrong: '#2a3550',
      surface: '#0a0e17', surfaceRaised: '#101828', surfaceSunken: '#0d1220',
      success: '#2dd4bf', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#2853c4', dark: '#7ea1ff' },
    heroBg: {
      light:
        'radial-gradient(90% 130% at 85% 0%, rgb(47 95 224 / 12%) 0%, transparent 55%), linear-gradient(135deg, #eaeef7 0%, #f5f7fb 100%)',
      dark:
        'radial-gradient(90% 130% at 85% 0%, rgb(79 124 255 / 22%) 0%, transparent 55%), #0a0e17',
    },
    defaultRadius: 'soft',
    defaultFontPairing: 'inter',
    density: 0.95,
    typeScale: 1,
    display: 38,
  },
  editorial: {
    id: 'editorial',
    light: {
      primary: '#111111', primaryHover: '#2b2b2b', primaryDeep: '#000000',
      ink: '#111111', inkSoft: '#3c3c3c', muted: '#5f5f5f',
      line: '#e4e2de', lineStrong: '#111111',
      surface: '#ffffff', surfaceRaised: '#ffffff', surfaceSunken: '#f5f4f2',
      success: '#1f5f3f', warning: '#8a5a09', danger: '#a11212',
    },
    dark: {
      primary: '#111111', primaryHover: '#2b2b2b', primaryDeep: '#000000',
      ink: '#f0efec', inkSoft: '#cfcdc8', muted: '#a3a19b',
      line: '#2b2b2b', lineStrong: '#f0efec',
      surface: '#101010', surfaceRaised: '#1a1a1a', surfaceSunken: '#141414',
      success: '#79c8a0', warning: '#e0a63a', danger: '#f08a8a',
    },
    accentText: { light: '#111111', dark: '#f0efec' },
    heroBg: { light: '#f5f4f2', dark: '#141414' },
    defaultRadius: 'sharp',
    defaultFontPairing: 'playfair',
    density: 1.15,
    typeScale: 1.14,
    display: 52,
  },
  market: {
    id: 'market',
    light: {
      primary: '#c05f22', primaryHover: '#a34e1b', primaryDeep: '#864016',
      ink: '#2d3a26', inkSoft: '#48573e', muted: '#576749',
      line: '#e3ecd9', lineStrong: '#cadbb8',
      surface: '#fffdf7', surfaceRaised: '#ffffff', surfaceSunken: '#f2f7e9',
      success: '#3f6d3a', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#c05f22', primaryHover: '#e07b39', primaryDeep: '#a34e1b',
      ink: '#eaf2df', inkSoft: '#cdd9be', muted: '#9cab8a',
      line: '#242c1c', lineStrong: '#333e28',
      surface: '#12160e', surfaceRaised: '#1a2013', surfaceSunken: '#161b10',
      success: '#8fc784', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#9a4a19', dark: '#eda05f' },
    heroBg: {
      light: 'linear-gradient(120deg, #eaf4e2 0%, #fffdf7 100%)',
      dark: 'linear-gradient(120deg, #1a2013 0%, #12160e 100%)',
    },
    defaultRadius: 'round',
    defaultFontPairing: 'nunito',
    density: 0.9,
    typeScale: 0.98,
    display: 36,
  },
  studio: {
    id: 'studio',
    light: {
      primary: '#5f6852', primaryHover: '#4d543f', primaryDeep: '#3d4433',
      ink: '#42403c', inkSoft: '#615e57', muted: '#6b6a64',
      line: '#e5e2db', lineStrong: '#d1ccc0',
      surface: '#f6f5f3', surfaceRaised: '#ffffff', surfaceSunken: '#edeae4',
      success: '#4d543f', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#5f6852', primaryHover: '#7d8471', primaryDeep: '#4d543f',
      ink: '#e9e7e1', inkSoft: '#cdc9bf', muted: '#a29c8f',
      line: '#2a2822', lineStrong: '#3a372f',
      surface: '#161512', surfaceRaised: '#201e1a', surfaceSunken: '#1a1915',
      success: '#a3ad92', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#49503c', dark: '#b3bda0' },
    heroBg: {
      light: 'linear-gradient(150deg, #e9e5de 0%, #f6f5f3 100%)',
      dark: 'linear-gradient(150deg, #201e1a 0%, #161512 100%)',
    },
    defaultRadius: 'soft',
    defaultFontPairing: 'inter',
    density: 1.2,
    typeScale: 1.08,
    display: 46,
  },
};
