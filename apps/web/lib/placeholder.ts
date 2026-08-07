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
 */
export function placeholderFor(id: string, name: string): { gradient: string; initials: string } {
  const hue = hash(id) % 360;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]!.toUpperCase())
      .join('') || '?';

  return {
    gradient: `linear-gradient(135deg, hsl(${hue} 32% 82%), hsl(${(hue + 40) % 360} 28% 92%))`,
    initials,
  };
}
