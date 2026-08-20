import { Controller, Post, UseInterceptors } from '@nestjs/common';
import { CheckoutRequest, CheckoutRequestSchema, OrderResponse } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { CheckoutService } from './checkout.service';

@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  // Same idempotency contract as POST /orders: the client's key belongs to the
  // intent, and a retry replays the first response instead of double-ordering.
  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CheckoutRequestSchema) body: CheckoutRequest): Promise<OrderResponse> {
    return this.checkout.checkout(body);
  }
}
