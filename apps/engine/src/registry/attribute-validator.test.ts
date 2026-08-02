import { FieldDefinition } from '@marketplace/contracts';
import { validateAttributes } from './attribute-validator';

const fields: Record<string, FieldDefinition> = {
  dietaryNeeds: { type: 'string', required: false, default: 'none' },
  seats: { type: 'number', required: true, default: null },
  vip: { type: 'boolean', required: false, default: null },
  tags: { type: 'string[]', required: false, default: null },
  startsOn: { type: 'date', required: false, default: null },
};

describe('validateAttributes', () => {
  it('accepts valid input and applies defaults for absent optional fields', () => {
    const result = validateAttributes(fields, { seats: 4 });
    expect(result).toEqual({ ok: true, value: { seats: 4, dietaryNeeds: 'none' } });
  });

  it('reports a missing required field', () => {
    const result = validateAttributes(fields, {});
    expect(result).toMatchObject({ ok: false });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'seats', code: 'required' }),
    );
  });

  it('reports an unknown field', () => {
    const result = validateAttributes(fields, { seats: 4, colour: 'red' });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'colour', code: 'unknown_field' }),
    );
  });

  it('reports a wrong scalar type', () => {
    const result = validateAttributes(fields, { seats: 'four' });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'seats', code: 'invalid_type' }),
    );
  });

  it('validates array element types', () => {
    expect(validateAttributes(fields, { seats: 1, tags: ['a', 'b'] }).ok).toBe(true);
    expect(validateAttributes(fields, { seats: 1, tags: ['a', 2] }).ok).toBe(false);
  });

  it('validates ISO-8601 dates', () => {
    expect(validateAttributes(fields, { seats: 1, startsOn: '2026-08-03T10:00:00.000Z' }).ok).toBe(true);
    expect(validateAttributes(fields, { seats: 1, startsOn: 'tomorrow' }).ok).toBe(false);
  });

  it('accepts anything when the tenant has defined no fields', () => {
    expect(validateAttributes({}, {})).toEqual({ ok: true, value: {} });
  });
});
