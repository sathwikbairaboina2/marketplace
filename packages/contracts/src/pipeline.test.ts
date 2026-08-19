import {
  DEFAULT_PIPELINE,
  MAX_STAGES,
  PipelineSchema,
  StageSchema,
  UpdatePipelineSchema,
} from './pipeline';

const stage = (over: Record<string, unknown> = {}) => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'Packed',
  cancellable: false,
  messaging: false,
  ...over,
});

describe('StageSchema', () => {
  it('trims the name', () => {
    expect(StageSchema.parse(stage({ name: '  Packed  ' })).name).toBe('Packed');
  });

  it('rejects a whitespace-only name', () => {
    expect(() => StageSchema.parse(stage({ name: '   ' }))).toThrow();
  });

  it('rejects a name past the bound', () => {
    expect(() => StageSchema.parse(stage({ name: 'x'.repeat(61) }))).toThrow();
  });

  it('defaults both switches to false', () => {
    const parsed = StageSchema.parse({ id: stage().id, name: 'Packed' });
    expect(parsed).toMatchObject({ cancellable: false, messaging: false });
  });

  it('rejects an unknown key', () => {
    expect(() => StageSchema.parse(stage({ colour: 'red' }))).toThrow();
  });
});

describe('UpdatePipelineSchema', () => {
  const body = (stages: unknown[]) => ({ version: 0, stages });

  it('accepts a stage with no id, for a stage being added', () => {
    const parsed = UpdatePipelineSchema.parse(body([{ name: 'New' }]));
    expect(parsed.stages[0].id).toBeUndefined();
  });

  it('rejects an empty stage list', () => {
    expect(() => UpdatePipelineSchema.parse(body([]))).toThrow();
  });

  it(`rejects more than ${MAX_STAGES} stages`, () => {
    const many = Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({ name: `S${i}` }));
    expect(() => UpdatePipelineSchema.parse(body(many))).toThrow();
  });

  it('rejects two stages sharing an id', () => {
    expect(() => UpdatePipelineSchema.parse(body([stage(), stage({ name: 'Other' })]))).toThrow(
      /duplicate/i,
    );
  });

  it('rejects two stages whose names differ only by case or padding', () => {
    expect(() =>
      UpdatePipelineSchema.parse(body([{ name: 'Packed' }, { name: '  packed ' }])),
    ).toThrow(/duplicate/i);
  });
});

describe('DEFAULT_PIPELINE', () => {
  it('is a valid pipeline of exactly one cancellable stage at version 0', () => {
    expect(PipelineSchema.parse(DEFAULT_PIPELINE)).toEqual(DEFAULT_PIPELINE);
    expect(DEFAULT_PIPELINE.version).toBe(0);
    expect(DEFAULT_PIPELINE.stages).toHaveLength(1);
    expect(DEFAULT_PIPELINE.stages[0]).toMatchObject({ cancellable: true, messaging: false });
  });
});
