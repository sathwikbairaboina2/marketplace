import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { CreateFlow, CreateFlowSchema, Page } from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { FlowsService, FlowResponse } from './flows.service';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Post()
  @Roles('admin')
  propose(@ZodBody(CreateFlowSchema) body: CreateFlow): Promise<FlowResponse> {
    return this.flows.propose(body);
  }

  // 200, not 201: this acts on an existing resource (applying its diff), it does not create one.
  @Post(':id/execute')
  @HttpCode(200)
  @Roles('admin')
  execute(@Param('id') id: string): Promise<FlowResponse> {
    return this.flows.execute(id);
  }

  @Get()
  list(@ZodQuery(ListQuerySchema) query: ListQuery): Promise<Page<FlowResponse>> {
    return this.flows.list(query.limit, query.cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<FlowResponse> {
    return this.flows.get(id);
  }
}
