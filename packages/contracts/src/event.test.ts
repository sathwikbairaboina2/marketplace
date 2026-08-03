import { CreateEventSchema } from './event';

const valid = {
  title: 'Workshop',
  capacity: 25,
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-09-01T17:00:00.000Z',
  basePriceMinor: 150000,
  currency: 'INR',
};

describe('CreateEventSchema', () => {
  it('accepts a valid event and applies defaults', () => {
    const parsed = CreateEventSchema.parse(valid);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects an event whose end precedes its start', () => {
    expect(() => CreateEventSchema.parse({ ...valid, endDate: '2026-08-01T09:00:00.000Z' })).toThrow();
  });

  it('rejects an unknown core field, even alongside the .refine() date check', () => {
    // .strict() must be applied to the object before .refine() wraps it in a ZodEffects --
    // this pins that ordering so it can't silently regress back to permissive.
    expect(() => CreateEventSchema.parse({ ...valid, venue: 'Hall A' })).toThrow();
  });

  it('rejects capacity above the bound', () => {
    expect(() => CreateEventSchema.parse({ ...valid, capacity: 10_001 })).toThrow();
  });

  it('accepts capacity at the bound', () => {
    expect(CreateEventSchema.parse({ ...valid, capacity: 10_000 }).capacity).toBe(10_000);
  });

  it('rejects basePriceMinor above the bound', () => {
    expect(() => CreateEventSchema.parse({ ...valid, basePriceMinor: 10_000_000_001 })).toThrow();
  });
});
