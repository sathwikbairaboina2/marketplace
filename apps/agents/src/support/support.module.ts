import { Module } from '@nestjs/common';
import { EngineClientModule } from '../engine-client/engine-client.module';
import { LlmModule } from '../llm/llm.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [LlmModule, EngineClientModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
