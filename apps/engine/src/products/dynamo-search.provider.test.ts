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

  it('matches free text against the lowercased search blob', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ text: '  Stoneware MUG ' }))!;
    expect(filter.expression).toBe('contains(#f0, :v0)');
    expect(filter.names).toEqual({ '#f0': 'search' });
    // Lowercased at query time to meet the blob lowercased at write time --
    // DynamoDB contains() is case-sensitive.
    expect(filter.values).toEqual({ ':v0': 'stoneware mug' });
  });

  it('combines text with other clauses using AND', () => {
    const filter = buildProductFilter(
      SearchProductsSchema.parse({ text: 'mug', category: 'ceramics' }),
    )!;
    expect(filter.expression.split(' AND ')).toHaveLength(2);
    expect(filter.expression).toContain('contains(');
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
  it('forces the visible statuses and ignores a status in the criteria', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ status: 'draft' }), [
      'active',
      'out_of_stock',
    ])!;
    expect(filter.expression).toBe('#f0 IN (:v0, :v1)');
    expect(filter.names).toEqual({ '#f0': 'status' });
    expect(filter.values).toEqual({ ':v0': 'active', ':v1': 'out_of_stock' });
  });

  it('ANDs the visible statuses onto other clauses, last', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ category: 'mugs' }), ['active'])!;
    expect(filter.expression).toBe('#f0 = :v0 AND #f1 IN (:v1)');
    expect(filter.values).toEqual({ ':v0': 'mugs', ':v1': 'active' });
  });
});
