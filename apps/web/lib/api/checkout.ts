import {
  type Card,
  type CheckoutRequest,
  OrderResponseSchema,
} from '@marketplace/contracts';
import { request } from './http';

// `idempotencyKey` required at compile time, exactly as `createOrder`: the
// key is what makes a retried checkout replay the first order instead of
// creating a second one, and a required parameter keeps a caller from
// forgetting it.
export const checkout = (body: CheckoutRequest, idempotencyKey: string) =>
  request('/checkout', { method: 'POST', body, schema: OrderResponseSchema, idempotencyKey });

/** No idempotency key: the engine conditions the write on the order still
 * awaiting payment, so a retry is a clean 409 rather than a replayed success. */
export const payOrder = (id: string, card: Card) =>
  request(`/orders/${id}/pay`, { method: 'POST', body: { card }, schema: OrderResponseSchema });
