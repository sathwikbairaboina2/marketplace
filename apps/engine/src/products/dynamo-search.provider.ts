import { Injectable } from '@nestjs/common';
import { Page, ProductRecord, SearchProducts } from '@marketplace/contracts';
import { DynamoRepository, FilterSpec } from '../persistence/dynamo.repository';
import { skPrefix } from '../persistence/keys';
import { SearchProvider } from './search-provider';

export function buildProductFilter(criteria: SearchProducts): FilterSpec | undefined {
  const clauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let n = 0;

  // Free text matches the lowercased `search` blob written at create/update
  // time -- contains() is case-sensitive, so both sides are normalised to
  // lower case. First, so the clause order in tests reads query-then-filters.
  if (criteria.text !== undefined) {
    names[`#f${n}`] = 'search';
    values[`:v${n}`] = criteria.text.toLowerCase();
    clauses.push(`contains(#f${n}, :v${n})`);
    n++;
  }

  const core: Array<[string, unknown, string]> = [];
  if (criteria.category !== undefined) core.push(['category', criteria.category, '=']);
  if (criteria.status !== undefined) core.push(['status', criteria.status, '=']);
  if (criteria.priceMinorMin !== undefined) core.push(['priceMinor', criteria.priceMinorMin, '>=']);
  if (criteria.priceMinorMax !== undefined) core.push(['priceMinor', criteria.priceMinorMax, '<=']);

  for (const [field, value, op] of core) {
    names[`#f${n}`] = field;
    values[`:v${n}`] = value;
    clauses.push(`#f${n} ${op} :v${n}`);
    n++;
  }

  const attributeEntries = Object.entries(criteria.attributes);
  if (attributeEntries.length > 0) names['#a'] = 'attributes';
  for (const [field, value] of attributeEntries) {
    names[`#f${n}`] = field;
    values[`:v${n}`] = value;
    clauses.push(`#a.#f${n} = :v${n}`);
    n++;
  }

  if (clauses.length === 0) return undefined;
  return { expression: clauses.join(' AND '), names, values };
}

@Injectable()
export class DynamoSearchProvider implements SearchProvider {
  constructor(private readonly repo: DynamoRepository) {}

  search(criteria: SearchProducts): Promise<Page<ProductRecord>> {
    return this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), {
      limit: criteria.limit,
      cursor: criteria.cursor,
      filter: buildProductFilter(criteria),
    });
  }
}
