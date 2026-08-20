import { Injectable } from '@nestjs/common';
import { CheckoutRequest, OrderResponse } from '@marketplace/contracts';
import { CartService } from '../cart/cart.service';
import { OrdersService } from '../orders/orders.service';
import { ProblemException } from '../common/problem';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly cart: CartService,
    private readonly orders: OrdersService,
  ) {}

  async checkout(input: CheckoutRequest): Promise<OrderResponse> {
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
      { awaitPayment: true },
    );
    await this.cart.clear();
    return order;
  }
}
