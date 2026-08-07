import { theme, type ThemeConfig } from 'antd';

export type Mode = 'light' | 'dark';

/**
 * Slate and teal. Shopify-informed rather than Shopify's own green, which on a
 * product that is not theirs would read as borrowed rather than referenced.
 */
export const palette = {
  // Teal-700, not teal-600. This is a *fill* with white text on it, and white
  // on #0d9488 is 3.74:1 -- every primary button in the app failed. Each step
  // below moves down one notch so hover and deep keep their relationship.
  primary: '#0f766e',
  primaryHover: '#115e59',
  primaryDeep: '#134e4a',
  // The back-office sidebar is dark in both themes, so an accent that works on
  // white does not work on it: #0f766e on #0f172a is 3.26:1. This is the same
  // hue two steps lighter (7.17:1) and is used only against sidebar surfaces.
  sidebarAccent: '#14b8a6',
  ink: '#0f172a',
  inkSoft: '#334155',
  // Was #64748b, which is 4.34:1 against the sunken surface it sits on in table
  // headers and tag backgrounds -- under the 4.5:1 floor. Darkened until it
  // clears on every surface in the palette (5.03 sunken, 5.26 base, 5.51
  // raised).
  muted: '#5c6a7d',
  line: '#e2e8f0',
  lineStrong: '#cbd5e1',
  surface: '#f8fafc',
  surfaceRaised: '#ffffff',
  surfaceSunken: '#f1f5f9',
  // The back-office sidebar is dark by design, not by theme: it keeps this
  // colour in light mode too. Flipping it white would undo the decision the
  // whole admin chrome is built on.
  sidebar: '#0f172a',
  sidebarItem: '#1e293b',
  sidebarText: '#94a3b8',
  sidebarTextStrong: '#e2e8f0',
  success: '#0f766e',
  warning: '#b45309',
  danger: '#b91c1c',
} as const;

const darkOverrides = {
  ink: '#e6edf5',
  inkSoft: '#c3ced9',
  muted: '#8b9bb0',
  line: '#1e2b3d',
  lineStrong: '#2b3a50',
  surface: '#080d16',
  surfaceRaised: '#0f1725',
  surfaceSunken: '#0b111c',
} as const;

/** 4px rhythm. Every gap, pad and margin comes from here. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

export const radius = { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 } as const;

export const fontSize = {
  xs: 12,
  sm: 13,
  base: 14,
  md: 16,
  lg: 20,
  xl: 25,
  xxl: 32,
} as const;

/**
 * Shadows are tinted with the ink colour rather than pure black. Black shadows
 * over a blue-grey surface read as dirty; a tinted one reads as depth.
 */
const shadowLight = {
  sm: '0 1px 2px rgb(15 23 42 / 6%)',
  md: '0 1px 3px rgb(15 23 42 / 8%), 0 4px 12px rgb(15 23 42 / 5%)',
  lg: '0 2px 6px rgb(15 23 42 / 8%), 0 12px 28px rgb(15 23 42 / 10%)',
};

// Shadow barely reads on a dark surface, so depth there comes mostly from a
// lighter raised background plus a hairline. Keep a faint shadow for the lift
// on hover to still feel like motion rather than a colour change.
const shadowDark = {
  sm: '0 1px 2px rgb(0 0 0 / 40%)',
  md: '0 2px 6px rgb(0 0 0 / 45%)',
  lg: '0 8px 28px rgb(0 0 0 / 55%)',
};

export function antdTheme(mode: Mode): ThemeConfig {
  const dark = mode === 'dark';
  const c = dark ? { ...palette, ...darkOverrides } : palette;

  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: palette.primary,
      // ANTD derives colorLink from colorPrimary, which is a fill colour: as
      // text on a white container it is 3.74:1. Set explicitly so ANTD's own
      // links and text buttons clear the same floor the custom ones do.
      colorLink: dark ? '#2dd4bf' : palette.primary,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.danger,
      colorBgBase: c.surface,
      colorBgContainer: c.surfaceRaised,
      colorBorder: c.line,
      colorBorderSecondary: c.line,
      colorText: c.ink,
      colorTextSecondary: c.inkSoft,
      colorTextTertiary: c.muted,
      borderRadius: radius.md,
      borderRadiusLG: radius.lg,
      borderRadiusSM: radius.sm,
      fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
      fontSize: fontSize.base,
      controlHeight: 36,
      lineHeight: 1.55,
      wireframe: false,
    },
    components: {
      Layout: { bodyBg: c.surface },
      Card: { borderRadiusLG: radius.lg, paddingLG: space[6] },
      Table: {
        headerBg: dark ? c.surfaceSunken : c.surface,
        headerColor: c.muted,
        headerSplitColor: 'transparent',
        rowHoverBg: dark ? c.surfaceSunken : palette.surfaceSunken,
        cellPaddingBlock: space[3],
        borderColor: c.line,
      },
      Button: { fontWeight: 550, primaryShadow: 'none', defaultShadow: 'none' },
      Input: { paddingBlock: 6 },
      Tag: { defaultBg: dark ? c.surfaceSunken : palette.surfaceSunken },
      Drawer: { paddingLG: space[4] },
    },
  };
}

/**
 * The surfaces ANTD does not own -- sidebar, hero, filter rail, product card.
 * Derived from the same palette object as `antdTheme` on purpose: a colour that
 * lives in two places drifts the first time one of them is adjusted.
 */
export function cssVars(mode: Mode): Record<string, string> {
  const dark = mode === 'dark';
  const c = dark ? { ...palette, ...darkOverrides } : palette;
  const shadow = dark ? shadowDark : shadowLight;

  return {
    '--mp-primary': c.primary,
    // Distinct from --mp-primary, which is a *fill* -- white text on it, so its
    // own contrast against the page never mattered. As text it did: #0d9488 on
    // white is 3.74:1, and every link in the app was drawn in it. These clear
    // 4.5:1 on every surface of their theme (5.47 light, 9.65 dark).
    '--mp-primary-text': dark ? '#2dd4bf' : palette.primary,
    '--mp-primary-text-hover': dark ? '#5eead4' : palette.primaryHover,
    '--mp-primary-hover': palette.primaryHover,
    '--mp-sidebar-accent': palette.sidebarAccent,
    '--mp-primary-deep': palette.primaryDeep,
    '--mp-primary-wash': dark ? 'rgb(13 148 136 / 16%)' : 'rgb(13 148 136 / 10%)',
    '--mp-ink': c.ink,
    '--mp-ink-soft': c.inkSoft,
    '--mp-muted': c.muted,
    '--mp-line': c.line,
    '--mp-line-strong': c.lineStrong,
    '--mp-surface': c.surface,
    '--mp-surface-raised': c.surfaceRaised,
    '--mp-surface-sunken': c.surfaceSunken,
    // Status colours the custom surfaces need. They were being hardcoded in
    // theme.css -- `#b45309` appeared there literally, which is `warning`
    // copied by hand and free to drift from it.
    '--mp-success': dark ? '#2dd4bf' : palette.success,
    // The light amber is 3.58:1 on a dark surface. Both status colours take a
    // lighter value in dark mode for the same reason ink does.
    '--mp-warning': dark ? '#f59e0b' : palette.warning,
    '--mp-danger': dark ? '#f87171' : palette.danger,

    '--mp-sidebar': palette.sidebar,
    '--mp-sidebar-item': palette.sidebarItem,
    '--mp-sidebar-text': palette.sidebarText,
    '--mp-sidebar-text-strong': palette.sidebarTextStrong,

    '--mp-shadow-sm': shadow.sm,
    '--mp-shadow-md': shadow.md,
    '--mp-shadow-lg': shadow.lg,

    '--mp-radius-sm': `${radius.sm}px`,
    '--mp-radius-md': `${radius.md}px`,
    '--mp-radius-lg': `${radius.lg}px`,
    '--mp-radius-xl': `${radius.xl}px`,
    '--mp-radius-pill': `${radius.pill}px`,

    '--mp-space-1': `${space[1]}px`,
    '--mp-space-2': `${space[2]}px`,
    '--mp-space-3': `${space[3]}px`,
    '--mp-space-4': `${space[4]}px`,
    '--mp-space-5': `${space[5]}px`,
    '--mp-space-6': `${space[6]}px`,
    '--mp-space-8': `${space[8]}px`,
    '--mp-space-10': `${space[10]}px`,
    '--mp-space-12': `${space[12]}px`,

    '--mp-text-xs': `${fontSize.xs}px`,
    '--mp-text-sm': `${fontSize.sm}px`,
    '--mp-text-base': `${fontSize.base}px`,
    '--mp-text-md': `${fontSize.md}px`,
    '--mp-text-lg': `${fontSize.lg}px`,
    '--mp-text-xl': `${fontSize.xl}px`,
    '--mp-text-xxl': `${fontSize.xxl}px`,

    // Lightness and saturation for generated placeholder art, so it sits in the
    // page rather than glowing out of it. Fixed values looked like pastel
    // slabs against a dark background.
    // Low saturation on purpose. At 30% these read as colour blocks and the
    // grid looks like a toy; near 16% they read as tinted neutrals that let the
    // real photography be the only saturated thing on the page.
    '--mp-placeholder-from': dark ? '16% 20%' : '20% 93%',
    '--mp-placeholder-to': dark ? '12% 14%' : '16% 97%',
    '--mp-placeholder-ink': dark ? '#7d8ea6' : '#94a3b8',
  };
}
