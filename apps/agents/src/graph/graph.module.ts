import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { CHECKPOINTER, createCheckpointer } from './checkpointer';
import { GraphService } from './graph.service';

@Module({
  providers: [
    GraphService,
    { provide: CHECKPOINTER, inject: [ENV], useFactory: (env: EnvConfig) => createCheckpointer(env) },
  ],
  // CHECKPOINTER is exported so OnboardingModule's graph shares this Redis
  // saver instead of opening a second connection.
  exports: [GraphService, CHECKPOINTER],
})
export class GraphModule {}
