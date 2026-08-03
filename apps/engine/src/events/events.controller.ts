import { Controller, Get, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CreateEvent, CreateEventSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { EventsService, EventResponse } from './events.service';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
const ListEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@ZodBody(CreateEventSchema) body: CreateEvent): Promise<EventResponse> {
    return this.events.create(body);
  }

  @Get()
  list(@ZodQuery(ListEventsQuerySchema) query: ListEventsQuery): Promise<Page<EventResponse>> {
    return this.events.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<EventResponse> {
    return this.events.get(id);
  }
}
