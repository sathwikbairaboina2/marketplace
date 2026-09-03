import { type CreateBooking, BookingResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(BookingResponseSchema);

// Required for the same reason as createOrder's: POST /bookings rejects a
// request that arrives without the header.
export const createBooking = (body: CreateBooking, idempotencyKey: string) =>
  request('/bookings', { method: 'POST', body, schema: BookingResponseSchema, idempotencyKey });

export const listBookings = (limit: number, cursor: string | null) =>
  request('/bookings', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

/** Every booking in the shop, newest first. Admin only -- the seller's
 * attendance list, crossing the per-user scoping `listBookings` applies. */
export const listAllBookings = (limit: number, cursor: string | null) =>
  request('/bookings/all', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getBooking = (id: string) =>
  request(`/bookings/${id}`, { schema: BookingResponseSchema });
