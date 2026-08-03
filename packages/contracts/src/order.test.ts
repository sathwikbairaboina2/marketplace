import { CreateOrderSchema } from './order';

const valid = {
  items: [{ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', quantity: 1 }],
  currency: 'INR',
  shippingAddress: { line1: '1 Road' },
};

describe('CreateOrderSchema', () => {
  it('accepts a valid order and applies defaults', () => {
    const parsed = CreateOrderSchema.parse(valid);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects an unknown core field', () => {
    expect(() => CreateOrderSchema.parse({ ...valid, discountCode: 'SAVE10' })).toThrow();
  });

  it('rejects a line item quantity above the bound', () => {
    expect(() =>
      CreateOrderSchema.parse({
        ...valid,
        items: [{ productId: valid.items[0].productId, quantity: 10_001 }],
      }),
    ).toThrow();
  });

  it('accepts a line item quantity at the bound', () => {
    const parsed = CreateOrderSchema.parse({
      ...valid,
      items: [{ productId: valid.items[0].productId, quantity: 10_000 }],
    });
    expect(parsed.items[0].quantity).toBe(10_000);
  });
});
