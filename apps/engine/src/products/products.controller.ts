import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateProduct,
  CreateProductSchema,
  Page,
  SearchProducts,
  SearchProductsSchema,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { ProductsService, ProductResponse } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(@ZodBody(CreateProductSchema) body: CreateProduct): Promise<ProductResponse> {
    return this.products.create(body);
  }

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<ProductResponse>> {
    return this.products.list(limit ? Number(limit) : 25, cursor ?? null);
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
