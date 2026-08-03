import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { ThreadRegistryService } from './thread-registry.service';
import { ThreadsController } from './threads.controller';

@Module({
  imports: [GraphModule],
  controllers: [ThreadsController],
  providers: [ThreadRegistryService],
  exports: [ThreadRegistryService],
})
export class ThreadsModule {}
