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
