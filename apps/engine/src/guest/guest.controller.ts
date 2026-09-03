import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CartResponse,
  GuestCheckoutRequest,
  GuestCheckoutRequestSchema,
  GuestTokenResponse,
  OrderLookup,
  OrderLookupSchema,
  OrderResponse,
  PayRequest,
  PayRequestSchema,
  PutCartLine,
  PutCartLineSchema,
} from '@marketplace/contracts';
import { Public } from '../auth/public.decorator';
import { ZodBody } from '../common/zod-validation.pipe';
import { ENV, EnvConfig } from '../config/env.schema';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import { OrdersService } from '../orders/orders.service';
import { ShopScope } from '../shops/shop-scope';
import { GuestGuard } from './guest.guard';
import { mintGuest } from './guest-token';

/** Ten lookups a minute per address: an order id plus an email is guessable only by brute force. */
const LOOKUP_LIMIT = 10;
const LOOKUP_TTL_MS = 60_000;

/**
 * A stranger's cart and checkout on one shop. Every route here is the token
 * route's twin under /shops/:tenantId, run as `guest:<id>` instead of a
 * Cognito user, and the services are the same ones -- they key on the
 * principal's user id and never ask where it came from.
 */
@Controller('shops/:tenantId')
export class GuestController {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    private readonly scope: ShopScope,
    private readonly cart: CartService,
    private readonly checkout: CheckoutService,
    private readonly orders: OrdersService,
  ) {}

  /** A fresh ticket for this shop. Free to mint: a ticket with no cart is nothing. */
  @Post('guest')
  @Public()
  @HttpCode(201)
  mint(@Param('tenantId') tenantId: string): Promise<GuestTokenResponse> {
    return this.scope.run(tenantId, async () => ({ guest: mintGuest(this.env.GUEST_SECRET, tenantId) }));
  }

  @Get('cart')
  @Public()
  @UseGuards(GuestGuard)
  getCart(): Promise<CartResponse> {
    return this.cart.get();
  }

  @Put('cart/lines/:productId')
  @Public()
  @UseGuards(GuestGuard)
  putLine(
    @Param('productId') productId: string,
    @ZodBody(PutCartLineSchema) body: PutCartLine,
  ): Promise<CartResponse> {
    return this.cart.putLine(productId, body.qty);
  }

  @Delete('cart')
  @Public()
  @UseGuards(GuestGuard)
  clearCart(): Promise<CartResponse> {
    return this.cart.clear();
  }

  // Idempotent exactly as POST /checkout: the key belongs to the intent.
  @Post('checkout')
  @Public()
  @UseGuards(GuestGuard)
  @UseInterceptors(IdempotencyInterceptor)
  guestCheckout(@ZodBody(GuestCheckoutRequestSchema) body: GuestCheckoutRequest): Promise<OrderResponse> {
    const { email, ...input } = body;
    return this.checkout.checkout(input, { guestEmail: email });
  }

  @Get('orders/:id')
  @Public()
  @UseGuards(GuestGuard)
  getOrder(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.get(id);
  }

  @Post('orders/:id/pay')
  @Public()
  @UseGuards(GuestGuard)
  @HttpCode(200)
  pay(@Param('id') id: string, @ZodBody(PayRequestSchema) body: PayRequest): Promise<OrderResponse> {
    return this.orders.pay(id, body.card);
  }

  /**
   * No ticket needed: the confirmation page told the guest to keep the order
   * id with their email, and a new browser has neither ticket nor cart. Same
   * 404 for a wrong id and a wrong email, so neither confirms the other.
   */
  @Post('orders/lookup')
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: LOOKUP_LIMIT, ttl: LOOKUP_TTL_MS } })
  lookup(@Param('tenantId') tenantId: string, @ZodBody(OrderLookupSchema) body: OrderLookup): Promise<OrderResponse> {
    return this.scope.run(tenantId, () => this.orders.lookup(body.orderId, body.email));
  }
}
