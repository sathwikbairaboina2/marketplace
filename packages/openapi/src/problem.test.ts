import { PROBLEM_SCHEMA_NAME, ProblemSchema } from './problem';

describe('ProblemSchema', () => {
  it('is named Problem', () => {
    expect(PROBLEM_SCHEMA_NAME).toBe('Problem');
  });

  it('requires type, title and status', () => {
    expect(ProblemSchema.type).toBe('object');
    expect(ProblemSchema.required).toEqual(['type', 'title', 'status']);
  });

  it('declares detail as an optional string, not in required', () => {
    expect(ProblemSchema.properties?.detail).toEqual({ type: 'string' });
    expect(ProblemSchema.required).not.toContain('detail');
  });

  it('documents the instance and traceId fields ProblemFilter always appends', () => {
    expect(ProblemSchema.properties?.instance).toEqual({ type: 'string' });
    expect(ProblemSchema.properties?.traceId).toEqual({ type: 'string' });
  });

  it('allows any other field, to cover the per-type extra fields ProblemException accepts', () => {
    expect(ProblemSchema.additionalProperties).toBe(true);
  });
});
