import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { DynamoSearchProvider } from './dynamo-search.provider';
import { SEARCH_PROVIDER } from './search-provider';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, { provide: SEARCH_PROVIDER, useClass: DynamoSearchProvider }],
  exports: [ProductsService],
})
export class ProductsModule {}
