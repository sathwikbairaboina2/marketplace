import { Page, ProductRecord, SearchProducts } from '@marketplace/contracts';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchProvider {
  search(criteria: SearchProducts): Promise<Page<ProductRecord>>;
}
