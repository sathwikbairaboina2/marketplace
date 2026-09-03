import { Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { CreateBooking, CreateBookingSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { Roles } from '../auth/roles.decorator';
import { BookingsService, BookingResponse } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateBookingSchema) body: CreateBooking): Promise<BookingResponse> {
    return this.bookings.create(body);
  }

  @Get()
  list(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<BookingResponse>> {
    return this.bookings.listForCurrentUser(query.limit, query.cursor ?? null);
  }

  // Declared before `:id`, or Nest would match "all" as a booking id and this
  // route would never be reached. Admin on the route as well as in the
  // service, like /orders/all: the decorator shows the restriction in the
  // OpenAPI document, the service check is what protects a non-HTTP caller.
  @Get('all')
  @Roles('admin')
  listForTenant(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<BookingResponse>> {
    return this.bookings.listForTenant(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BookingResponse> {
    return this.bookings.get(id);
  }
}
