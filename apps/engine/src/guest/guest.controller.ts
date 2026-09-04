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
  BookingResponse,
  GuestBooking,
  GuestBookingSchema,
  GuestCancelRequest,
  GuestCancelRequestSchema,
  GuestPayRequest,
  GuestPayRequestSchema,
  OrderResponse,
  PutCartLine,
  PutCartLineSchema,
} from '@marketplace/contracts';
import { Public } from '../auth/public.decorator';
import { ZodBody } from '../common/zod-validation.pipe';
import { ENV, EnvConfig } from '../config/env.schema';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { CartService } from '../cart/cart.service';
import { CheckoutService } from '../checkout/checkout.service';
import { BookingsService } from '../bookings/bookings.service';
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
    private readonly bookings: BookingsService,
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

  /**
   * The email is optional and is the same one `orders/lookup` takes. A ticket
   * belongs to a browser and an order outlives it: without this, a guest who
   * signs in, clears storage or returns on another device holds an order that
   * no route can pay for, with its stock reserved until the seller cancels it
   * by hand.
   */
  @Post('orders/:id/pay')
  @Public()
  @UseGuards(GuestGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: LOOKUP_LIMIT, ttl: LOOKUP_TTL_MS } })
  pay(
    @Param('id') id: string,
    @ZodBody(GuestPayRequestSchema) body: GuestPayRequest,
  ): Promise<OrderResponse> {
    return this.orders.pay(id, body.card, { guestEmail: body.email });
  }

  /**
   * The cancel the engine already believes a guest is entitled to: an order in
   * the payment gate holds stock nobody has paid for, and before this route
   * only the seller could give it back.
   */
  @Post('orders/:id/cancel')
  @Public()
  @UseGuards(GuestGuard)
  @HttpCode(200)
  @Throttle({ default: { limit: LOOKUP_LIMIT, ttl: LOOKUP_TTL_MS } })
  cancel(
    @Param('id') id: string,
    @ZodBody(GuestCancelRequestSchema) body: GuestCancelRequest,
  ): Promise<OrderResponse> {
    return this.orders.cancel(id, { guestEmail: body.email });
  }

  /**
   * A stranger booking a class. The wedge this product is sold on, and until
   * this route existed it converted at exactly zero: "Sign in to book" led to
   * a login page in an app that has no sign-up route at all.
   *
   * The same shape as guest checkout -- the capacity claim, the overselling
   * guard and the booking record are the service's, unchanged, because it keys
   * on the principal and never asks where it came from.
   */
  @Post('bookings')
  @Public()
  @UseGuards(GuestGuard)
  @UseInterceptors(IdempotencyInterceptor)
  guestBook(@ZodBody(GuestBookingSchema) body: GuestBooking): Promise<BookingResponse> {
    const { email, ...input } = body;
    return this.bookings.create(input, { guestEmail: email });
  }

  @Get('bookings/:id')
  @Public()
  @UseGuards(GuestGuard)
  getBooking(@Param('id') id: string): Promise<BookingResponse> {
    return this.bookings.get(id);
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
