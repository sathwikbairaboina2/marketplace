import { CreateProductSchema, SearchProductsSchema } from './product';

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

  // `.min(1)` counted characters, so a name of nothing but spaces passed and a
  // product with no visible name reached the storefront as a blank card.
  it('rejects a name that is only whitespace', () => {
    expect(() => CreateProductSchema.parse({ ...valid, name: '   ' })).toThrow();
  });

  it('rejects a name that is only a tab or newline', () => {
    expect(() => CreateProductSchema.parse({ ...valid, name: '\t\n' })).toThrow();
  });

  it('keeps a name that merely has surrounding space, trimmed', () => {
    expect(CreateProductSchema.parse({ ...valid, name: '  Chair  ' }).name).toBe('Chair');
  });

  it('rejects a category that is only whitespace', () => {
    expect(() => CreateProductSchema.parse({ ...valid, category: ' ' })).toThrow();
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

  it('rejects stock above the bound', () => {
    expect(() => CreateProductSchema.parse({ ...valid, stock: 10_001 })).toThrow();
  });

  it('accepts stock at the bound', () => {
    expect(CreateProductSchema.parse({ ...valid, stock: 10_000 }).stock).toBe(10_000);
  });

  it('rejects priceMinor above the bound', () => {
    expect(() => CreateProductSchema.parse({ ...valid, priceMinor: 10_000_000_001 })).toThrow();
  });

  it('rejects an unknown core field', () => {
    // The design spec states unknown core fields are rejected -- a client typo like
    // `atributes: {...}` must be a validation error, not silently stripped and written with an
    // empty `attributes`.
    expect(() => CreateProductSchema.parse({ ...valid, atributes: { color: 'red' } })).toThrow();
  });
});

describe('SearchProductsSchema', () => {
  it('accepts an empty search and applies defaults', () => {
    const parsed = SearchProductsSchema.parse({});
    expect(parsed.limit).toBe(25);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects an unknown core field', () => {
    expect(() => SearchProductsSchema.parse({ categroy: 'chairs' })).toThrow();
  });
});
