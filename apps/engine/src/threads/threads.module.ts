import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ThreadsController } from './threads.controller';
import { ThreadsService } from './threads.service';

// OrdersModule for its OrdersService: a thread reads its order through the same
// normalisation the order endpoints use, rather than a second copy of it.
@Module({
  imports: [OrdersModule],
  controllers: [ThreadsController],
  providers: [ThreadsService],
})
export class ThreadsModule {}
