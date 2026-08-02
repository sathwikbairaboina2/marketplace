import { CreateProductSchema } from './product';

const valid = {
  name: 'Chair',
  description: 'A chair',
  priceMinor: 4999,
  currency: 'INR',
  category: 'furniture',
  stock: 10,
};

describe('CreateProductSchema', () => {
  it('accepts a valid product and applies defaults', () => {
    const parsed = CreateProductSchema.parse(valid);
    expect(parsed.status).toBe('draft');
    expect(parsed.images).toEqual([]);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects fractional money', () => {
    expect(() => CreateProductSchema.parse({ ...valid, priceMinor: 49.99 })).toThrow();
  });

  it('rejects a non ISO-4217 currency', () => {
    expect(() => CreateProductSchema.parse({ ...valid, currency: 'rupees' })).toThrow();
  });

  it('rejects negative stock', () => {
    expect(() => CreateProductSchema.parse({ ...valid, stock: -1 })).toThrow();
  });
});
