import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderCheckoutService } from './order-checkout.service';
import { OrderPaymentService } from './order-payment.service';
import { OrderLifecycleService } from './order-lifecycle.service';

@Module({
  imports: [PipelineModule, PaymentsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderCheckoutService, OrderPaymentService, OrderLifecycleService],
  exports: [OrdersService],
})
export class OrdersModule {}
