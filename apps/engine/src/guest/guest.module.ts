import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { CartModule } from '../cart/cart.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersModule } from '../orders/orders.module';
import { ShopScope } from '../shops/shop-scope';
import { GuestController } from './guest.controller';
import { GuestGuard } from './guest.guard';

/**
 * Guest checkout on the public shop surface. Owns the ticket and the guard;
 * the cart, checkout and order logic stay where they are and run under the
 * guest principal unchanged.
 */
@Module({
  imports: [BookingsModule, CartModule, CheckoutModule, OrdersModule],
  controllers: [GuestController],
  providers: [GuestGuard, ShopScope],
})
export class GuestModule {}
