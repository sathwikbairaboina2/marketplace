import { Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CreateMessage, CreateMessageSchema, MessageResponse, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { ThreadsService } from './threads.service';

/**
 * A message POST is a cheaper spam vector than anything else exposed: one small
 * write and no transaction, so it gets a bucket ten times tighter than the
 * global 600 a minute.
 *
 * Not tighter than this, because the limiter is keyed by address and runs
 * *before* authentication -- deliberately, since a limiter that only sees
 * authenticated requests stops neither a flood nor a password list. That means
 * one bucket is shared by everyone behind a single address, so a household or
 * an office would hit a stricter limit between them while each person was
 * sending perfectly ordinary messages.
 */
export const MESSAGE_RATE_LIMIT = 60;
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
