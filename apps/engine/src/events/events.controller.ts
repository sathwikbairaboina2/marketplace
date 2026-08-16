import { Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CreateEvent, CreateEventSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { EventsService, EventResponse } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @Roles('admin')
  create(@ZodBody(CreateEventSchema) body: CreateEvent): Promise<EventResponse> {
    return this.events.create(body);
  }

  @Get()
  list(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<EventResponse>> {
    return this.events.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<EventResponse> {
    return this.events.get(id);
  }
}
