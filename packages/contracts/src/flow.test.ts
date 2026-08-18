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

  it('rejects an unknown core field', () => {
    expect(() =>
      CreateFlowSchema.parse({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string' }] },
        requestedBy: 'agent-42',
      }),
    ).toThrow();
  });
});

describe('a dynamic field may not shadow a field the entity already has', () => {
  const flow = (targetEntity: string, name: string) => ({
    targetEntity,
    actionType: 'ADD_FIELDS',
    blueprintDiff: { addedFields: [{ name, type: 'string' }] },
  });

  // A tenant asking the assistant for "a name field" got one: a second field
  // called `name`, stored under `attributes` and rendered as a second input
  // labelled "Name" on the seller's form, with no way to tell the two apart
  // and no route to remove it afterwards.
  it.each(['name', 'description', 'priceMinor', 'category', 'stock', 'status', 'images'])(
    'rejects a Product field called %s',
    (name) => {
      expect(() => CreateFlowSchema.parse(flow('Product', name))).toThrow();
    },
  );

  it.each(['id', 'entityType', 'createdAt', 'attributes', 'PK', 'SK'])(
    'rejects the structural field %s on any entity',
    (name) => {
      expect(() => CreateFlowSchema.parse(flow('Product', name))).toThrow();
      expect(() => CreateFlowSchema.parse(flow('Event', name))).toThrow();
    },
  );

  it.each(['title', 'capacity', 'bookedCount', 'startDate', 'endDate', 'basePriceMinor'])(
    'rejects an Event field called %s',
    (name) => {
      expect(() => CreateFlowSchema.parse(flow('Event', name))).toThrow();
    },
  );

  it('rejects a Booking field called ticketQuantity', () => {
    expect(() => CreateFlowSchema.parse(flow('Booking', 'ticketQuantity'))).toThrow();
  });

  it('rejects an Order field called totalAmountMinor', () => {
    expect(() => CreateFlowSchema.parse(flow('Order', 'totalAmountMinor'))).toThrow();
  });

  // The stage snapshot an order carries is core, not dynamic: a tenant field
  // called `stages` would shadow it exactly as a second `name` shadowed a
  // product's, and here it would also be indistinguishable from the lifecycle
  // the buyer's tracker renders.
  it.each(['stages', 'currentStageId', 'pipelineVersion', 'stageEnteredAt'])(
    'rejects an Order field called %s',
    (name) => {
      expect(() => CreateFlowSchema.parse(flow('Order', name))).toThrow();
    },
  );

  // The reservation is per entity: `capacity` means something to an Event and
  // nothing to a Product, so a shop selling containers may still describe one.
  it('allows a Product field called capacity, which only Events reserve', () => {
    expect(() => CreateFlowSchema.parse(flow('Product', 'capacity'))).not.toThrow();
  });

  it('allows an ordinary new field', () => {
    expect(() => CreateFlowSchema.parse(flow('Product', 'colour'))).not.toThrow();
  });

  it('names the offending field in the error', () => {
    try {
      CreateFlowSchema.parse(flow('Product', 'stock'));
      throw new Error('expected the parse to fail');
    } catch (err) {
      expect(String(err)).toMatch(/stock/);
    }
  });

  it('rejects a collision hidden among valid fields', () => {
    expect(() =>
      CreateFlowSchema.parse({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: {
          addedFields: [
            { name: 'colour', type: 'string' },
            { name: 'status', type: 'string' },
          ],
        },
      }),
    ).toThrow();
  });
});
