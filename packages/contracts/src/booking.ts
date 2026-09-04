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
  // Who is actually coming. A class is six people in a room on a Saturday, and
  // the merchant has to be able to ring the one who has not arrived, message
  // the group, and tick people in. Booking shipped before any of that was
  // captured: the cockpit could show a reference code and nothing else.
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(4).max(32),
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
  /** Who is coming, so the merchant can run the class they sold. */
  attendeeName?: string;
  attendeePhone?: string;
  reference?: string;
  createdAt: string;
  attributes: Record<string, unknown>;
}
