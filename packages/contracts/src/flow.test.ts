import { BlueprintDiffSchema, CreateFlowSchema } from './flow';

describe('BlueprintDiffSchema', () => {
  it('accepts an add-fields diff', () => {
    const parsed = BlueprintDiffSchema.parse({
      addedFields: [{ name: 'dietaryNeeds', type: 'string' }],
    });
    expect(parsed.addedFields[0].required).toBe(false);
    expect(parsed.addedFields[0].default).toBeNull();
  });

  it('rejects a destructive diff', () => {
    expect(() =>
      BlueprintDiffSchema.parse({
        addedFields: [{ name: 'dietaryNeeds', type: 'string' }],
        removedFields: ['price'],
      }),
    ).toThrow();
  });

  it('rejects an empty diff', () => {
    expect(() => BlueprintDiffSchema.parse({ addedFields: [] })).toThrow();
  });

  it('rejects a field name that is not an identifier', () => {
    expect(() =>
      BlueprintDiffSchema.parse({ addedFields: [{ name: '2bad', type: 'string' }] }),
    ).toThrow();
  });
});

describe('CreateFlowSchema', () => {
  it('rejects an unsupported action type', () => {
    expect(() =>
      CreateFlowSchema.parse({
        targetEntity: 'Product',
        actionType: 'REMOVE_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string' }] },
      }),
    ).toThrow();
  });
});
