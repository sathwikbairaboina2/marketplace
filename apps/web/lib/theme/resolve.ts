import { contrastRatio, type StorefrontConfig } from '@marketplace/contracts';
import { cssVars, type Mode } from './tokens';
import { FONT_STACKS, PRESETS, RADIUS_VALUES } from './presets';

const DEFAULT_FONTS = FONT_STACKS.inter;

/**
 * One function from tenant choice to CSS variables. Null config = today's
 * default vars exactly (plus the two font vars every path now emits), so a
 * tenant that never ran the wizard renders as before.
 */
export function resolveTheme(config: StorefrontConfig | null, mode: Mode): Record<string, string> {
  const base = cssVars(mode);
  if (!config) {
    return {
      ...base,
      '--mp-font-heading': DEFAULT_FONTS.heading,
      '--mp-font-body': DEFAULT_FONTS.body,
    };
  }

  const preset = PRESETS[config.presetId];
  const c = preset[mode];
  const accent = config.overrides.accent ?? c.primary;
  // Accent as text only when it reads on this mode's surface; otherwise the
  // preset's own pre-checked text accent. The contracts fill rule already
  // guarantees white-on-accent for buttons.
  const accentText = contrastRatio(accent, c.surface) >= 4.5 ? accent : preset.accentText[mode];
  const radius = RADIUS_VALUES[config.overrides.radiusScale ?? preset.defaultRadius];
  const fonts = FONT_STACKS[config.overrides.fontPairing ?? preset.defaultFontPairing];

  return {
    ...base,
    '--mp-primary': accent,
    '--mp-primary-hover': c.primaryHover,
    '--mp-primary-deep': c.primaryDeep,
    '--mp-primary-text': accentText,
    '--mp-primary-text-hover': accentText,
    '--mp-primary-wash': `${accent}1a`,
    '--mp-ink': c.ink,
    '--mp-ink-soft': c.inkSoft,
    '--mp-muted': c.muted,
    '--mp-line': c.line,
    '--mp-line-strong': c.lineStrong,
    '--mp-surface': c.surface,
    '--mp-surface-raised': c.surfaceRaised,
    '--mp-surface-sunken': c.surfaceSunken,
    '--mp-success': c.success,
    '--mp-warning': c.warning,
    '--mp-danger': c.danger,
    '--mp-hero-bg': preset.heroBg[mode],
    '--mp-hero-ink': c.ink,
    '--mp-hero-muted': c.muted,
    '--mp-hero-eyebrow': accentText,
    '--mp-radius-sm': `${radius.sm}px`,
    '--mp-radius-md': `${radius.md}px`,
    '--mp-radius-lg': `${radius.lg}px`,
    '--mp-radius-xl': `${radius.xl}px`,
    '--mp-font-heading': fonts.heading,
    '--mp-font-body': fonts.body,
  };
}

/** What the shop shell hands its nested antd ConfigProvider; null = leave default. */
export function resolveAntdAccent(config: StorefrontConfig | null, mode: Mode): string | null {
  if (!config) return null;
  return config.overrides.accent ?? PRESETS[config.presetId][mode].primary;
}
