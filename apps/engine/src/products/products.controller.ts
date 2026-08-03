import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CreateProduct,
  CreateProductSchema,
  Page,
  SearchProducts,
  SearchProductsSchema,
} from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ProductsService, ProductResponse } from './products.service';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
const ListProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
type ListProductsQuery = z.infer<typeof ListProductsQuerySchema>;

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(@ZodBody(CreateProductSchema) body: CreateProduct): Promise<ProductResponse> {
    return this.products.create(body);
  }

  @Get()
  list(@ZodQuery(ListProductsQuerySchema) query: ListProductsQuery): Promise<Page<ProductResponse>> {
    return this.products.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProductResponse> {
    return this.products.get(id);
  }

  @Post('search')
  @HttpCode(200)
  search(@ZodBody(SearchProductsSchema) body: SearchProducts): Promise<Page<ProductResponse>> {
    return this.products.search(body);
  }
}
