/** Cheap, stable string hash. Not security-relevant -- it only needs to spread. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A deterministic stand-in for a product with no photograph, so a grid never
 * renders as a row of broken boxes.
 *
 * Seeded from the product id rather than randomly: the same product must look
 * the same on every render and every reload, or it reads as a loading defect.
 *
 * Only the hue is chosen here. Saturation and lightness come from
 * `--mp-placeholder-from` / `--mp-placeholder-to`, which the theme sets -- so
 * the same product is a soft tint on a light page and a deep tone on a dark
 * one, instead of the same pastel slab glaring out of both.
 */
// Five hues from the brand's neighbourhood -- green, teal, cyan, blue, indigo.
// A tile can be any of these and still sit inside the page's palette; the old
// hash % 360 produced maroon and olive slabs that sat outside it.
const HUES = [158, 172, 199, 214, 244] as const;

export function placeholderFor(id: string, name: string): { gradient: string; initials: string } {
  const hue = HUES[hash(id) % HUES.length]!;
  const next = HUES[(hash(id) + 1) % HUES.length]!;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join('') || '?';

  return {
    gradient:
      `linear-gradient(135deg, hsl(${hue} var(--mp-placeholder-from)), ` +
      `hsl(${next} var(--mp-placeholder-to)))`,
    initials,
  };
}
