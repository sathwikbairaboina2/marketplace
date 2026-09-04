import { z } from 'zod';
import { AttributesSchema, UlidSchema } from './common';

export const BookingStatusSchema = z.enum(['confirmed', 'cancelled']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const CreateBookingSchema = z
  .object({
    eventId: UlidSchema,
    ticketQuantity: z.number().int().positive().max(100),
    attributes: AttributesSchema.default({}),
  })
  .strict();
export type CreateBooking = z.infer<typeof CreateBookingSchema>;

/**
 * A stranger booking a class. The email is what a guest order already takes:
 * the booking is theirs, and it is how they find it again from a browser that
 * no longer holds the ticket. Booking was the product's stated wedge and, until
 * this existed, "Sign in to book" led to a login page in an app with no
 * sign-up route -- a wall, not a detour.
 */
export const GuestBookingSchema = CreateBookingSchema.extend({
  email: z.string().trim().toLowerCase().email().max(254),
});
export type GuestBooking = z.infer<typeof GuestBookingSchema>;

export interface BookingRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'Booking';
  id: string;
  eventId: string;
  userId: string;
  status: BookingStatus;
  ticketQuantity: number;
  /** Present on a stranger's booking only, exactly as on a guest's order. */
  guestEmail?: string;
  reference?: string;
  createdAt: string;
  attributes: Record<string, unknown>;
}
