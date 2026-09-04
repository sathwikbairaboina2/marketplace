import { contrastRatio, type StorefrontConfig } from '@marketplace/contracts';
import { cssVars, fontSize, space, type Mode } from './tokens';
import { FONT_STACKS, PRESETS, RADIUS_VALUES, type Preset } from './presets';

const DEFAULT_FONTS = FONT_STACKS.inter;

/** A storefront's body size. 14px is the cockpit's, on a page shoppers read. */
const SHOP_BODY_PX = 16;

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
    // Left on the base palette, these were the theme's visible leaks: a teal
    // hairline round a brown shop's banner, cool slate monograms on a cream
    // page, and slate-tinted shadows under warm cards.
    '--mp-hero-border': `${accent}33`,
    '--mp-placeholder-ink': c.muted,
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
    ...scaleVars(preset),
  };
}

/**
 * The shop's own rhythm and type ladder. `--mp-space-*` and `--mp-text-*` are
 * emitted once for the whole app and were never overridden, so every preset
 * shared one measure and one ladder -- `artisan` and `editorial` rendered the
 * same About page to the pixel, and the only thing separating five presets was
 * colour.
 *
 * Multipliers rather than five hand-written scales: the base scale is already
 * a considered ratio, and what a preset wants is to be more or less generous
 * with it, not to redraw it. Rounded to whole pixels so nothing lands on a
 * half-pixel border.
 */
function scaleVars(preset: Preset): Record<string, string> {
  const px = (value: number, factor: number) => `${Math.round(value * factor)}px`;
  const d = preset.density;
  const t = preset.typeScale;
  return {
    '--mp-space-1': px(space[1], d),
    '--mp-space-2': px(space[2], d),
    '--mp-space-3': px(space[3], d),
    '--mp-space-4': px(space[4], d),
    '--mp-space-5': px(space[5], d),
    '--mp-space-6': px(space[6], d),
    '--mp-space-8': px(space[8], d),
    '--mp-space-10': px(space[10], d),
    '--mp-space-12': px(space[12], d),
    // The body size is the shop's, not the cockpit's 14px, and it does not
    // scale with the preset: 16px is the floor for a page read on a phone.
    '--mp-text-xs': px(fontSize.xs, 1),
    '--mp-text-sm': px(fontSize.sm, 1),
    '--mp-text-base': px(fontSize.base, 1),
    '--mp-text-md': `${SHOP_BODY_PX}px`,
    '--mp-text-lg': px(fontSize.lg, t),
    '--mp-text-xl': px(fontSize.xl, t),
    '--mp-text-xxl': px(fontSize.xxl, t),
    // The step above the ladder's ceiling, which nothing had: a hero headline
    // and a page title were the same 32px as a section heading.
    '--mp-text-display': `${preset.display}px`,
  };
}

/** What the shop shell hands its nested antd ConfigProvider; null = leave default. */
export function resolveAntdAccent(config: StorefrontConfig | null, mode: Mode): string | null {
  if (!config) return null;
  return config.overrides.accent ?? PRESETS[config.presetId][mode].primary;
}
