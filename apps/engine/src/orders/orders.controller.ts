import { Controller, Get, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import {
  AdvanceOrder,
  AdvanceOrderSchema,
  CreateOrder,
  CreateOrderSchema,
  Page,
} from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { Roles } from '../auth/roles.decorator';
import { OrdersService, OrderResponse } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateOrderSchema) body: CreateOrder): Promise<OrderResponse> {
    return this.orders.create(body);
  }

  @Get()
  list(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<OrderResponse>> {
    return this.orders.listForCurrentUser(query.limit, query.cursor ?? null);
  }

  // Declared before `:id`, or Nest would match "all" as an order id and this
  // route would never be reached.
  @Get('all')
  @Roles('admin')
  listForTenant(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<OrderResponse>> {
    return this.orders.listForTenant(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.get(id);
  }

  // Admin only on the route as well as in the service, matching every other
  // admin-only write: the decorator is what shows the restriction in the
  // OpenAPI document, the service check is what the tests pin.
  // No IdempotencyInterceptor: the status condition in the service already makes
  // cancel single-shot, and a replayed 200 would tell a buyer a second cancel
  // succeeded when it did nothing.
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.cancel(id);
  }

  @Post(':id/advance')
  // 200, not Nest's default 201: an advance creates nothing, it moves an order
  // that already exists.
  @HttpCode(200)
  @Roles('admin')
  advance(
    @Param('id') id: string,
    @ZodBody(AdvanceOrderSchema) body: AdvanceOrder,
  ): Promise<OrderResponse> {
    return this.orders.advance(id, body.currentStageId);
  }
}
