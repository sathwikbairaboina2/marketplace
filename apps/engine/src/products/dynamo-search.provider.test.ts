import { SearchProductsSchema } from '@marketplace/contracts';
import { buildProductFilter } from './dynamo-search.provider';

describe('buildProductFilter', () => {
  it('returns undefined when nothing is filtered', () => {
    expect(buildProductFilter(SearchProductsSchema.parse({}))).toBeUndefined();
  });

  it('filters on a core field', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ category: 'chairs' }))!;
    expect(filter.expression).toBe('#f0 = :v0');
    expect(filter.names).toEqual({ '#f0': 'category' });
    expect(filter.values).toEqual({ ':v0': 'chairs' });
  });

  it('filters on a nested dynamic attribute', () => {
    const filter = buildProductFilter(
      SearchProductsSchema.parse({ attributes: { dietaryNeeds: 'vegan' } }),
    )!;
    expect(filter.expression).toBe('#a.#f0 = :v0');
    expect(filter.names).toEqual({ '#a': 'attributes', '#f0': 'dietaryNeeds' });
    expect(filter.values).toEqual({ ':v0': 'vegan' });
  });

  it('combines core, range and attribute filters with AND', () => {
    const filter = buildProductFilter(
      SearchProductsSchema.parse({
        status: 'active',
        priceMinorMin: 1000,
        priceMinorMax: 5000,
        attributes: { dietaryNeeds: 'vegan' },
      }),
    )!;
    expect(filter.expression.split(' AND ')).toHaveLength(4);
    expect(Object.keys(filter.values)).toHaveLength(4);
  });
});
