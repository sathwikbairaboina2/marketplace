import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  controllers: [CartController],
  providers: [CartService],
  // Exported for the checkout module, which reads and clears the cart.
  exports: [CartService],
})
export class CartModule {}
