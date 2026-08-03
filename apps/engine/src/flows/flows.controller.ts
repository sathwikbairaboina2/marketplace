import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CreateFlow, CreateFlowSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { FlowsService, FlowResponse } from './flows.service';

// Query params arrive as strings (or are absent); z.coerce.number() converts a present
// `limit` and rejects it with a 400 problem (via ZodQuery) if it isn't a valid integer in
// range, instead of letting `NaN` reach DynamoDB's `Limit` and surface as an opaque 500.
const ListFlowsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
type ListFlowsQuery = z.infer<typeof ListFlowsQuerySchema>;

@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Post()
  propose(@ZodBody(CreateFlowSchema) body: CreateFlow): Promise<FlowResponse> {
    return this.flows.propose(body);
  }

  // 200, not 201: this acts on an existing resource (applying its diff), it does not create one.
  @Post(':id/execute')
  @HttpCode(200)
  execute(@Param('id') id: string): Promise<FlowResponse> {
    return this.flows.execute(id);
  }

  @Get()
  list(@ZodQuery(ListFlowsQuerySchema) query: ListFlowsQuery): Promise<Page<FlowResponse>> {
    return this.flows.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<FlowResponse> {
    return this.flows.get(id);
  }
}
