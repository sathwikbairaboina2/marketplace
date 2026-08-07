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
