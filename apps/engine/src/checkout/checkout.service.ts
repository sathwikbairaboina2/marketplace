import { Injectable, Logger } from '@nestjs/common';
import { CheckoutRequest, OrderResponse } from '@marketplace/contracts';
import { CartService } from '../cart/cart.service';
import { OrdersService } from '../orders/orders.service';
import { NotificationsService } from '../notifications/notifications.service';
import { orderConfirmation } from '../notifications/messages';
import { StorefrontService } from '../storefront/storefront.service';
import { currentPrincipal } from '../common/tenant-context';
import { ProblemException } from '../common/problem';

/**
 * Minor units to something a person reads. Deliberately not Intl: this string
 * goes into an email, and the engine has no business guessing a locale for a
 * customer it knows only by address.
 */
function formatMinor(minor: number, currency: string): string {
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly storefront: StorefrontService,
  ) {}

  /** The shop's own name, for anything it signs. Falls back to the tenant id. */
  private async shopName(): Promise<string> {
    const published = await this.storefront.getPublished();
    return published?.businessProfile?.name ?? currentPrincipal().tenantId;
  }

  async checkout(input: CheckoutRequest, opts: { guestEmail?: string } = {}): Promise<OrderResponse> {
    const resolved = await this.cart.get();
    if (resolved.lines.length === 0) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Cart is empty',
        'add something to the cart before checking out',
      );
    }
    const unavailable = resolved.lines.find((l) => l.unavailable);
    if (unavailable) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Product no longer available',
        `${unavailable.name} is no longer available; remove it from the cart`,
        { productId: unavailable.productId },
      );
    }

    // The order transaction re-validates stock and price with conditions; this
    // service only shapes the input. The cart survives a failed checkout so
    // the buyer can adjust it; it is cleared only after the order exists.
    const order = await this.orders.create(
      {
        ...input,
        items: resolved.lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
      },
      { awaitPayment: true, guestEmail: opts.guestEmail },
    );

    // Best-effort once the order exists. If this throw propagated, the
    // idempotency interceptor would release the claim and a retry with the
    // same key would re-run checkout against a still-populated cart --
    // creating a second order and reserving stock twice. A stale cart is
    // recoverable; a duplicate reservation is not.
    try {
      await this.cart.clear();
    } catch (err) {
      this.logger.warn({ orderId: order.id, err }, 'order created but the cart failed to clear');
    }

    // The first thing this product has ever sent a customer. Best effort by
    // construction -- NotificationsService swallows a provider failure -- and
    // awaited rather than fired off, so a test can assert the outbox without
    // racing it. Only a guest gets one: a signed-in buyer has the order in
    // their own list.
    if (opts.guestEmail) {
      const shopName = await this.shopName();
      const { subject, body } = orderConfirmation(order, shopName, (minor) =>
        formatMinor(minor, order.currency),
      );
      await this.notifications.send({
        kind: 'order-confirmation',
        to: opts.guestEmail,
        subject,
        body,
        about: order.reference,
      });
    }
    return order;
  }
}
