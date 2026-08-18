import { Controller, Get, Put } from '@nestjs/common';
import { Pipeline, UpdatePipeline, UpdatePipelineSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { PipelineService } from './pipeline.service';

@Controller('settings')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('pipeline')
  get(): Promise<Pipeline> {
    return this.pipeline.get();
  }

  // Declared here as well as checked in the service, matching the announcement
  // route: the service check is what the unit tests pin and what protects any
  // future non-HTTP caller, the decorator is what makes the restriction visible
  // on the route and in the OpenAPI document.
  @Put('pipeline')
  @Roles('admin')
  update(@ZodBody(UpdatePipelineSchema) body: UpdatePipeline): Promise<Pipeline> {
    return this.pipeline.update(body);
  }
}
