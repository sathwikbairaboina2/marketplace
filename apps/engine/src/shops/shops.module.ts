import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ProductsModule } from '../products/products.module';
import { SettingsModule } from '../settings/settings.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { PaymentsModule } from '../payments/payments.module';
import { GuestGuard } from '../guest/guest.guard';
import { ShopScope } from './shop-scope';
import { ShopsController } from './shops.controller';

/**
 * The public read surface. Owns no data of its own: it imports the modules
 * whose services already know each entity and adds only the scope that lets a
 * request with no token name a tenant.
 */
@Module({
  imports: [ProductsModule, EventsModule, StorefrontModule, SettingsModule, PaymentsModule],
  controllers: [ShopsController],
  providers: [ShopScope, GuestGuard],
})
export class ShopsModule {}
