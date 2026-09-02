import { Page, ProductRecord, ProductStatus, SearchProducts } from '@marketplace/contracts';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchOptions {
  /** When set, only these statuses match and any `status` in the criteria is ignored. */
  statuses?: readonly ProductStatus[];
}

export interface SearchProvider {
  search(criteria: SearchProducts, opts?: SearchOptions): Promise<Page<ProductRecord>>;
}
