import { Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateMessage, CreateMessageSchema, MessageResponse, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { ThreadsService } from './threads.service';

/**
 * A message POST is a cheaper spam vector than anything else exposed: one small
 * write, no transaction, and a buyer legitimately sends a handful per order
 * rather than dozens a minute.
 */
export const MESSAGE_RATE_LIMIT = 10;
export const MESSAGE_RATE_TTL_MS = 60_000;

@Controller('orders')
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Post(':id/messages')
  @Throttle({ default: { limit: MESSAGE_RATE_LIMIT, ttl: MESSAGE_RATE_TTL_MS } })
  post(
    @Param('id') id: string,
    @ZodBody(CreateMessageSchema) body: CreateMessage,
  ): Promise<MessageResponse> {
    return this.threads.post(id, body);
  }

  @Get(':id/messages')
  list(
    @Param('id') id: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<MessageResponse>> {
    return this.threads.list(id, query.limit, query.cursor ?? null);
  }
}
