import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { CopywriterController } from './copywriter.controller';
import { CopywriterService } from './copywriter.service';

@Module({
  imports: [LlmModule],
  controllers: [CopywriterController],
  providers: [CopywriterService],
})
export class CopywriterModule {}
