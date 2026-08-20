import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import {
  BatchCreateProducts,
  BatchCreateProductsSchema,
  CreateProduct,
  CreateProductSchema,
  Page,
  SearchProducts,
  SearchProductsSchema,
  UpdateProduct,
  UpdateProductSchema,
} from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { ProductsService, ProductResponse } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Roles('admin')
  create(@ZodBody(CreateProductSchema) body: CreateProduct): Promise<ProductResponse> {
    return this.products.create(body);
  }

  // Declared before ':id' routes for the same reason as /orders/all: Nest
  // would otherwise match 'batch' as a product id.
  @Post('batch')
  @Roles('admin')
  createBatch(
    @ZodBody(BatchCreateProductsSchema) body: BatchCreateProducts,
  ): Promise<{ items: ProductResponse[] }> {
    return this.products.createBatch(body.items).then((items) => ({ items }));
  }

  @Get()
  list(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<ProductResponse>> {
    return this.products.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProductResponse> {
    return this.products.get(id);
  }

  // PATCH, not PUT: a seller correcting a price should not have to resend the
  // whole product, and a partial body cannot silently blank the fields it omits.
  @Patch(':id')
  @Roles('admin')
  update(
    @Param('id') id: string,
    @ZodBody(UpdateProductSchema) body: UpdateProduct,
  ): Promise<ProductResponse> {
    return this.products.update(id, body);
  }

  @Post('search')
  @HttpCode(200)
  search(@ZodBody(SearchProductsSchema) body: SearchProducts): Promise<Page<ProductResponse>> {
    return this.products.search(body);
  }
}
