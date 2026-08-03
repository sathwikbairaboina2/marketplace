import { Inject, Injectable } from '@nestjs/common';
import { CreateProduct, Page, ProductRecord, SearchProducts } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { SEARCH_PROVIDER, SearchProvider } from './search-provider';

// The HTTP-facing shape of a product. `ProductRecord` (from @marketplace/contracts) mirrors
// exactly what is stored in DynamoDB, including the single-table `PK`/`SK` attributes. Those
// are a persistence-layer implementation detail -- the tenant-scoped partition key and the
// entity-prefixed sort key -- and are deliberately not part of the public API surface: clients
// should never see, depend on, or be able to parse the internal key scheme.
export type ProductResponse = Omit<ProductRecord, 'PK' | 'SK'>;

function toResponse(record: ProductRecord): ProductResponse {
  const { PK: _pk, SK: _sk, ...rest } = record;
  return rest;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
  ) {}

  async create(input: CreateProduct): Promise<ProductResponse> {
    const attributes = await this.registry.validate('Product', input.attributes);
    const now = new Date().toISOString();
    const id = newId();

    const record: ProductResponse = {
      entityType: 'Product',
      id,
      status: input.status,
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

    await this.repo.put(entitySk('Product', id), record);
    return record;
  }

  async get(id: string): Promise<ProductResponse> {
    const found = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!found) throw new ProblemException('not-found', 404, 'Product not found');
    return toResponse(found);
  }

  async list(limit: number, cursor: string | null): Promise<Page<ProductResponse>> {
    const page = await this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }

  async search(criteria: SearchProducts): Promise<Page<ProductResponse>> {
    const page = await this.searchProvider.search(criteria);
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
}
