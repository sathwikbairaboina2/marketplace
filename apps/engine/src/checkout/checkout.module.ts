import { Module } from '@nestjs/common';
import { CartModule } from '../cart/cart.module';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorefrontModule } from '../storefront/storefront.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [CartModule, OrdersModule, NotificationsModule, StorefrontModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  // Exported for the guest module, whose routes check a stranger out.
  exports: [CheckoutService],
})
export class CheckoutModule {}
