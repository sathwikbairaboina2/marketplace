import { Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { CartResponse, MergeCart, MergeCartSchema, PutCartLine, PutCartLineSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';
import { guestUserId, verifyGuest } from '../guest/guest-token';
import { CartService } from './cart.service';

/**
 * Buyer-scoped: every route acts on the calling user's own cart. No roles
 * decorator -- any signed-in user of the tenant has a cart.
 */
@Controller('cart')
export class CartController {
  constructor(
    private readonly cart: CartService,
    @Inject(ENV) private readonly env: EnvConfig,
  ) {}

  /**
   * After sign-in: the cart built as a stranger joins this account's. The
   * ticket must be this shop's -- verified against the JWT's tenant, so a
   * ticket from another shop is refused rather than silently emptied.
   */
  @Post('merge')
  @HttpCode(200)
  merge(@ZodBody(MergeCartSchema) body: MergeCart): Promise<CartResponse> {
    const id = verifyGuest(this.env.GUEST_SECRET, currentPrincipal().tenantId, body.guest);
    if (!id) {
      throw new ProblemException('invalid-guest', 401, 'Guest ticket missing or not for this shop');
    }
    return this.cart.mergeFrom(guestUserId(id));
  }

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
