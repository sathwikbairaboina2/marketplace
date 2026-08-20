import {
  type Card,
  type CheckoutRequest,
  OrderResponseSchema,
} from '@marketplace/contracts';
import { request } from './http';

// `idempotencyKey` required, exactly as `createOrder`: POST /checkout rejects
// a request without the header, and the key is what makes a retried checkout
// replay the first order instead of creating a second one.
export const checkout = (body: CheckoutRequest, idempotencyKey: string) =>
  request('/checkout', { method: 'POST', body, schema: OrderResponseSchema, idempotencyKey });

/** No idempotency key: the engine conditions the write on the order still
 * awaiting payment, so a retry is a clean 409 rather than a replayed success. */
export const payOrder = (id: string, card: Card) =>
  request(`/orders/${id}/pay`, { method: 'POST', body: { card }, schema: OrderResponseSchema });
