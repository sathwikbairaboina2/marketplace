import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderPaymentService } from './order-payment.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { AbandonedOrdersService } from './abandoned-orders.service';

@Module({
  imports: [PipelineModule, PaymentsModule, SettingsModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderCheckoutService,
    OrderPaymentService,
    OrderLifecycleService,
    // The broom that gives back stock held by orders nobody ever paid for.
    AbandonedOrdersService,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
