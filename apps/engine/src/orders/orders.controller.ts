import { Controller, Get, HttpCode, Param, Post, UseInterceptors } from '@nestjs/common';
import {
  AdvanceOrder,
  AdvanceOrderSchema,
  CustomerLookup,
  CustomerLookupSchema,
  PaymentIntentResponse,
  StartPayment,
  StartPaymentSchema,
  CreateOrder,
  CreateOrderSchema,
  Page,
  PayRequest,
  PayRequestSchema,
} from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { Roles } from '../auth/roles.decorator';
import { OrdersService, OrderResponse } from './orders.service';
import { PaymentsService } from '../payments/payments.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

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

  // 200, not 201: paying moves an order that already exists. No
  // IdempotencyInterceptor: the status condition in the service makes pay
  // single-shot, and a replayed 200 would tell a buyer a second charge
  // succeeded when nothing happened.
  @Post(':id/pay')
  @HttpCode(200)
  pay(@Param('id') id: string, @ZodBody(PayRequestSchema) body: PayRequest): Promise<OrderResponse> {
    return this.orders.pay(id, body.card);
  }

  /**
   * The merchant recording that a deposit's balance was handed over in the
   * room. No money moves through this product; it is a note that it did.
   */
  /**
   * Everything one customer has bought here. Admin only: it is the merchant
   * looking somebody up by the number they are calling from.
   */
  @Post('customer-history')
  @HttpCode(200)
  @Roles('admin')
  customerHistory(
    @ZodBody(CustomerLookupSchema) body: CustomerLookup,
  ): Promise<OrderResponse[]> {
    return this.orders.historyFor(body);
  }

  /** Start a UPI payment on an order this caller owns. */
  @Post(':id/payments')
  @HttpCode(200)
  startPayment(
    @Param('id') id: string,
    @ZodBody(StartPaymentSchema) body: StartPayment,
  ): Promise<PaymentIntentResponse> {
    return this.payments.start(id, body);
  }

  @Post(':id/settle-balance')
  @HttpCode(200)
  @Roles('admin')
  settleBalance(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.settleBalance(id);
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
