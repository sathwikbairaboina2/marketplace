import { z } from 'zod';
import { AttributesSchema, UlidSchema } from './common';

export const BookingStatusSchema = z.enum(['confirmed', 'cancelled']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const CreateBookingSchema = z.object({
  eventId: UlidSchema,
  ticketQuantity: z.number().int().positive().max(100),
  attributes: AttributesSchema.default({}),
});
export type CreateBooking = z.infer<typeof CreateBookingSchema>;

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
  createdAt: string;
  attributes: Record<string, unknown>;
}
