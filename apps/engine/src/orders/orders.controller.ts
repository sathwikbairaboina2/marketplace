import { Controller, Get, Param, Post, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { CreateOrder, CreateOrderSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { OrdersService, OrderResponse } from './orders.service';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
const ListOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateOrderSchema) body: CreateOrder): Promise<OrderResponse> {
    return this.orders.create(body);
  }

  @Get()
  list(@ZodQuery(ListOrdersQuerySchema) query: ListOrdersQuery): Promise<Page<OrderResponse>> {
    return this.orders.listForCurrentUser(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.get(id);
  }
}
