import { Module } from '@nestjs/common';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

// No imports: DynamoRepository is provided globally, exactly as SettingsModule
// relies on. Exported because OrdersService reads the pipeline when it places an
// order into its first stage.
@Module({
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
