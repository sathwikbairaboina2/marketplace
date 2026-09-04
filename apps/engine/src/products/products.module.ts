import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { DynamoSearchProvider } from './dynamo-search.provider';
import { SEARCH_PROVIDER } from './search-provider';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorefrontModule } from '../storefront/storefront.module';

@Module({
  imports: [NotificationsModule, StorefrontModule],
  controllers: [ProductsController],
  providers: [ProductsService, { provide: SEARCH_PROVIDER, useClass: DynamoSearchProvider }],
  exports: [ProductsService],
})
export class ProductsModule {}
