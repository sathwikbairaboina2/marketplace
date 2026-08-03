import { Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { CreateBooking, CreateBookingSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { BookingsService, BookingResponse } from './bookings.service';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
const ListBookingsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
type ListBookingsQuery = z.infer<typeof ListBookingsQuerySchema>;

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateBookingSchema) body: CreateBooking): Promise<BookingResponse> {
    return this.bookings.create(body);
  }

  @Get()
  list(@ZodQuery(ListBookingsQuerySchema) query: ListBookingsQuery): Promise<Page<BookingResponse>> {
    return this.bookings.listForCurrentUser(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BookingResponse> {
    return this.bookings.get(id);
  }
}
