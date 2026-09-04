import { type CreateOrder, OrderResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(OrderResponseSchema);

// `idempotencyKey` is a required parameter, not an option: POST /orders rejects
// a request without the header, and making it optional here would move that
// failure from compile time to a 400 at runtime.
export const createOrder = (body: CreateOrder, idempotencyKey: string) =>
  request('/orders', { method: 'POST', body, schema: OrderResponseSchema, idempotencyKey });

export const listOrders = (limit: number, cursor: string | null) =>
  request('/orders', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getOrder = (id: string) => request(`/orders/${id}`, { schema: OrderResponseSchema });

/** Admin only. `currentStageId` is the stage the seller was looking at, so a
 * stale page cannot skip a stage: the engine conditions the write on it and
 * answers `stage-moved` if somebody else got there first. */
export const advanceOrder = (id: string, currentStageId: string) =>
  request(`/orders/${id}/advance`, {
    method: 'POST',
    body: { currentStageId },
    schema: OrderResponseSchema,
  });

/**
 * Admin only. The merchant recording that a deposit's balance was handed over
 * in the room -- no money moves through this product. The engine conditions
 * the write on the balance still being what the seller read, so two people
 * settling the same order cannot both succeed.
 */
export const settleOrderBalance = (id: string) =>
  request(`/orders/${id}/settle-balance`, { method: 'POST', schema: OrderResponseSchema });

/** No idempotency key: the engine conditions the cancel on the order still being
 * confirmed and still in the stage it read, so a retry is a clean 409 rather
 * than a replayed success. */
export const cancelOrder = (id: string) =>
  request(`/orders/${id}/cancel`, { method: 'POST', schema: OrderResponseSchema });

/** Every order in the shop, newest first. Admin only -- this is the seller's
 * queue of work, and it deliberately crosses the per-user scoping `listOrders`
 * applies. */
export const listAllOrders = (limit: number, cursor: string | null) =>
  request('/orders/all', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

/**
 * Everything one customer has bought here. Admin only: this is the merchant
 * looking up whoever is on the phone, by the number they are calling from.
 */
export const customerHistory = (handle: { email?: string; phone?: string }) =>
  request('/orders/customer-history', {
    method: 'POST',
    body: handle,
    schema: OrderResponseSchema.array(),
  });
