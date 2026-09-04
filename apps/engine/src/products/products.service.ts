import { Inject, Injectable } from '@nestjs/common';
import {
  CreateProduct,
  Page,
  ProductRecord,
  ProductResponse,
  ProductStatus,
  productSearchBlob,
  SearchProducts,
  SearchProductsSchema,
  UpdateProduct,
} from '@marketplace/contracts';
import { DynamoRepository, FilterSpec } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { foreignMediaUrl } from '../common/media-policy';
import { currentPrincipal } from '../common/tenant-context';
import { SEARCH_PROVIDER, SearchProvider } from './search-provider';
import { buildProductFilter } from './dynamo-search.provider';

/** Public media isolation (#05): a stored image must be this shop's own. */
function assertOwnMedia(images: readonly string[]): void {
  const foreign = foreignMediaUrl(images, currentPrincipal().tenantId);
  if (foreign !== null) {
    throw new ProblemException(
      'invalid-request',
      422,
      'Image is not this shop’s media',
      `upload images through this shop; ${foreign} points elsewhere`,
      { url: foreign },
    );
  }
}

/**
 * What a stranger may see. A draft is a half-written listing and an archived
 * product a withdrawn one; neither exists as far as the public surface is
 * concerned, so asking for one answers the 404 a made-up id would.
 */
export const VISIBLE_TO_SHOPPERS: readonly ProductStatus[] = ['active', 'out_of_stock'];
const EMPTY_CRITERIA = SearchProductsSchema.parse({});
const visibleFilter = (): FilterSpec => buildProductFilter(EMPTY_CRITERIA, VISIBLE_TO_SHOPPERS)!;

// The HTTP-facing shape of a product. `ProductRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes. Those
// are a persistence-layer implementation detail -- the tenant-scoped partition key and the
// entity-prefixed sort key -- and are deliberately not part of the public API surface: clients
// should never see, depend on, or be able to parse the internal key scheme.
//
// Defined as `z.infer<typeof ProductResponseSchema>` in @marketplace/contracts rather than as
// an `Omit<ProductRecord, ...>` here, so the browser client has a runtime schema to validate
// against and cannot drift from the type this service returns.
export type { ProductResponse };

function toResponse(record: ProductRecord): ProductResponse {
  const { PK: _pk, SK: _sk, search: _search, ...rest } = record;
  // Products written before the pin existed are not pinned.
  return { ...rest, pinned: rest.pinned ?? false };
}

/**
 * What a shopper cannot buy sorts last. The shop's order is otherwise the
 * ULID descending -- newest listed first (`dynamo.repository.ts` queries with
 * `ScanIndexForward: false`) -- which put a sold-out product in the first tile
 * of every storefront whose newest listing happened to be out of stock, and in
 * the first tile of every cross-sell besides.
 *
 * A pinned product comes first, then anything in stock. A stable sort within
 * the page, not an index: the page is what the shopper sees, a shop is capped
 * at 100 products, and reordering across pages would mean a second GSI and a
 * migration for a shop that has one page.
 */
export function sellableFirst(a: ProductResponse, b: ProductResponse): number {
  // What the merchant chose comes first; then what a shopper can actually buy.
  const pinned = Number(b.pinned) - Number(a.pinned);
  if (pinned !== 0) return pinned;
  return Number(a.stock <= 0) - Number(b.stock <= 0);
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
  ) {}

  async create(input: CreateProduct): Promise<ProductResponse> {
    assertOwnMedia(input.images);
    const attributes = await this.registry.validate('Product', input.attributes);
    const now = new Date().toISOString();
    const id = newId();

    const record: ProductResponse = {
      entityType: 'Product',
      id,
      status: input.status,
      pinned: input.pinned,
      name: input.name,
      description: input.description,
      priceMinor: input.priceMinor,
      currency: input.currency,
      category: input.category,
      stock: input.stock,
      images: input.images,
      createdAt: now,
      updatedAt: now,
      attributes,
    };

    // The search blob is persistence-only: stored beside the record, stripped
    // by toResponse, never on the wire.
    await this.repo.put(entitySk('Product', id), { ...record, search: productSearchBlob(record) });
    return record;
  }

  /**
   * Everything is validated against the registry before anything is written,
   * so a bad row rejects the whole batch up front rather than leaving a
   * half-created catalogue. The writes themselves are independent puts.
   */
  async createBatch(inputs: CreateProduct[]): Promise<ProductResponse[]> {
    for (const input of inputs) assertOwnMedia(input.images);
    const validated = await Promise.all(
      inputs.map((input) => this.registry.validate('Product', input.attributes)),
    );

    const now = new Date().toISOString();
    const records = inputs.map((input, i): ProductResponse => ({
      entityType: 'Product',
      id: newId(),
      status: input.status,
      pinned: input.pinned,
      name: input.name,
      description: input.description,
      priceMinor: input.priceMinor,
      currency: input.currency,
      category: input.category,
      stock: input.stock,
      images: input.images,
      createdAt: now,
      updatedAt: now,
      attributes: validated[i],
    }));

    await Promise.all(
      records.map((record) =>
        this.repo.put(entitySk('Product', record.id), {
          ...record,
          search: productSearchBlob(record),
        }),
      ),
    );
    return records;
  }

  async get(id: string): Promise<ProductResponse> {
    const found = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!found) throw new ProblemException('not-found', 404, 'Product not found');
    return toResponse(found);
  }

  /**
   * A partial change to an existing product.
   *
   * Read-modify-write rather than a Dynamo UpdateExpression: the record is
   * small, and it keeps one description of a product's shape -- the same
   * `put` creation uses -- instead of a second one built out of SET clauses.
   *
   * Two things are deliberately not the caller's to set. `createdAt` is
   * carried over from the stored record, so a patch cannot rewrite when the
   * product appeared; `updatedAt` is stamped here, so it cannot be faked.
   *
   * Repricing does not disturb orders already placed: an order records the
   * unit price it locked at the time, and nothing here reaches into one.
   */
  async update(id: string, patch: UpdateProduct): Promise<ProductResponse> {
    if (patch.images !== undefined) assertOwnMedia(patch.images);
    const existing = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!existing) throw new ProblemException('not-found', 404, 'Product not found');

    // Validated against the tenant's registry on the way in, exactly as on
    // creation -- an attribute nobody declared must not arrive by the side
    // door of an edit.
    const attributes =
      patch.attributes === undefined
        ? existing.attributes
        : await this.registry.validate('Product', patch.attributes);

    const updated: ProductResponse = {
      ...toResponse(existing),
      ...patch,
      attributes,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };

    await this.repo.put(entitySk('Product', id), {
      ...updated,
      search: productSearchBlob(updated),
    });
    return updated;
  }

  async list(limit: number, cursor: string | null): Promise<Page<ProductResponse>> {
    const page = await this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }

  async search(criteria: SearchProducts): Promise<Page<ProductResponse>> {
    const page = await this.searchProvider.search(criteria);
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }

  // The public surface. Filtered in the query, not after it, so a stranger's
  // page is a full page rather than one with holes where the drafts were.

  async getVisible(id: string): Promise<ProductResponse> {
    const found = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!found || !VISIBLE_TO_SHOPPERS.includes(found.status)) {
      throw new ProblemException('not-found', 404, 'Product not found');
    }
    return toResponse(found);
  }

  async listVisible(limit: number, cursor: string | null): Promise<Page<ProductResponse>> {
    const page = await this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), {
      limit,
      cursor,
      filter: visibleFilter(),
    });
    return { items: page.items.map(toResponse).sort(sellableFirst), nextCursor: page.nextCursor };
  }

  async searchVisible(criteria: SearchProducts): Promise<Page<ProductResponse>> {
    const page = await this.searchProvider.search(criteria, { statuses: VISIBLE_TO_SHOPPERS });
    return { items: page.items.map(toResponse).sort(sellableFirst), nextCursor: page.nextCursor };
  }
}
