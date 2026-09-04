import { describe, expect, it } from 'vitest';
import { placeholderFor } from './placeholder';

describe('placeholderFor', () => {
  // Determinism is the whole point: a product whose gradient changes between
  // renders reads as a loading bug rather than a design.
  it('is stable for the same id', () => {
    expect(placeholderFor('01J', 'Aeron Chair')).toEqual(placeholderFor('01J', 'Aeron Chair'));
  });

  it('differs across ids', () => {
    expect(placeholderFor('01J', 'X').gradient).not.toBe(placeholderFor('02K', 'X').gradient);
  });

  it('takes initials from the first two words', () => {
    expect(placeholderFor('01J', 'Aeron Desk Chair').initials).toBe('AD');
    expect(placeholderFor('01J', 'Keyboard').initials).toBe('K');
  });

  it('survives an empty or whitespace-only name', () => {
    expect(placeholderFor('01J', '').initials).toBe('?');
    expect(placeholderFor('01J', '   ').initials).toBe('?');
  });

  it('produces a usable CSS gradient', () => {
    expect(placeholderFor('01J', 'Chair').gradient).toMatch(/^linear-gradient\(/);
  });
});

it('draws every tile from the brand hue band where no shop supplies one', () => {
  // The hue is a custom property now, so a themed shop's tiles take the
  // merchant's colour. The *fallback* is what the platform host renders, and
  // it must still be one of the five palette hues rather than the full wheel.
  const allowed = new Set([158, 172, 199, 214, 244]);
  for (let i = 0; i < 50; i++) {
    const { gradient } = placeholderFor(`id-${i}`, 'Widget');
    const hues = [...gradient.matchAll(/var\(--mp-placeholder-hue, (\d+)\)/g)].map((m) =>
      Number(m[1]),
    );
    expect(hues.length).toBeGreaterThan(0);
    for (const hue of hues) expect(allowed.has(hue)).toBe(true);
  }
});

it('shifts a shop-supplied hue per product rather than repeating one tile', () => {
  // The shop's colour is the anchor; the product only moves it a little, so a
  // grid of photograph-less products is varied without leaving the palette.
  const shifts = new Set(
    Array.from({ length: 50 }, (_, i) => {
      const { gradient } = placeholderFor(`id-${i}`, 'Widget');
      return gradient.match(/var\(--mp-placeholder-hue, \d+\) \+ (-?\d+)\)/)?.[1];
    }),
  );
  expect(shifts.size).toBeGreaterThan(1);
  for (const shift of shifts) expect(Math.abs(Number(shift))).toBeLessThanOrEqual(16);
});
