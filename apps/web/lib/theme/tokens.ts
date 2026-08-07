import { theme, type ThemeConfig } from 'antd';

export type Mode = 'light' | 'dark';

/**
 * Slate and teal. Shopify-informed rather than Shopify's own green, which on a
 * product that is not theirs would read as borrowed rather than referenced.
 */
export const palette = {
  primary: '#0d9488',
  primaryDeep: '#115e59',
  ink: '#0f172a',
  muted: '#475569',
  line: '#e2e8f0',
  surface: '#f8fafc',
  surfaceRaised: '#ffffff',
  // The back-office sidebar is dark by design, not by theme: it stays this
  // colour in light mode too. Flipping it white would undo the decision the
  // whole admin chrome is built on.
  sidebar: '#0f172a',
  sidebarItem: '#1e293b',
  sidebarText: '#cbd5e1',
  success: '#0d9488',
  warning: '#b45309',
  danger: '#b91c1c',
} as const;

const darkOverrides = {
  ink: '#e2e8f0',
  muted: '#94a3b8',
  line: '#1e293b',
  surface: '#0b1220',
  surfaceRaised: '#111827',
} as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export function antdTheme(mode: Mode): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: palette.primary,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.danger,
      borderRadius: radius.md,
      fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
      fontSize: 14,
    },
    components: {
      Layout: { bodyBg: mode === 'dark' ? darkOverrides.surface : palette.surface },
      Card: { borderRadiusLG: radius.md },
      Table: { headerBg: mode === 'dark' ? darkOverrides.surfaceRaised : palette.surface },
    },
  };
}

/**
 * The surfaces ANTD does not own -- sidebar, hero, filter rail, product card.
 * Derived from the same palette object as `antdTheme` on purpose: a colour that
 * lives in two places drifts the first time one of them is adjusted.
 */
export function cssVars(mode: Mode): Record<string, string> {
  const m = mode === 'dark' ? { ...palette, ...darkOverrides } : palette;
  return {
    '--mp-primary': m.primary,
    '--mp-primary-deep': m.primaryDeep,
    '--mp-ink': m.ink,
    '--mp-muted': m.muted,
    '--mp-line': m.line,
    '--mp-surface': m.surface,
    '--mp-surface-raised': m.surfaceRaised,
    '--mp-sidebar': palette.sidebar,
    '--mp-sidebar-item': palette.sidebarItem,
    '--mp-sidebar-text': palette.sidebarText,
    '--mp-radius-sm': `${radius.sm}px`,
    '--mp-radius-md': `${radius.md}px`,
    '--mp-radius-lg': `${radius.lg}px`,
  };
}
