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

/** No idempotency key: the engine conditions the cancel on the order still being
 * confirmed and still in the stage it read, so a retry is a clean 409 rather
 * than a replayed success. */
export const cancelOrder = (id: string) =>
  request(`/orders/${id}/cancel`, { method: 'POST', schema: OrderResponseSchema });
