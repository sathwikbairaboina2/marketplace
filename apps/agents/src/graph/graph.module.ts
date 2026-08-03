import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { CHECKPOINTER, createCheckpointer } from './checkpointer';
import { GraphService } from './graph.service';

@Module({
  providers: [
    GraphService,
    { provide: CHECKPOINTER, inject: [ENV], useFactory: (env: EnvConfig) => createCheckpointer(env) },
  ],
  exports: [GraphService],
})
export class GraphModule {}
