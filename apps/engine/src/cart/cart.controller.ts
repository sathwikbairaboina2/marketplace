import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CartResponse, PutCartLine, PutCartLineSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { CartService } from './cart.service';

/**
 * Buyer-scoped: every route acts on the calling user's own cart. No roles
 * decorator -- any signed-in user of the tenant has a cart.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(): Promise<CartResponse> {
    return this.cart.get();
  }

  @Put('lines/:productId')
  putLine(
    @Param('productId') productId: string,
    @ZodBody(PutCartLineSchema) body: PutCartLine,
  ): Promise<CartResponse> {
    return this.cart.putLine(productId, body.qty);
  }

  @Delete()
  clear(): Promise<CartResponse> {
    return this.cart.clear();
  }
}
