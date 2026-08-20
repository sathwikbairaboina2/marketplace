import { Module } from '@nestjs/common';
import { EngineClientModule } from '../engine-client/engine-client.module';
import { GraphModule } from '../graph/graph.module';
import { OnboardingGraphService } from './onboarding-graph.service';

// GraphModule is imported for the CHECKPOINTER it exports: both graphs share
// one Redis saver rather than each opening its own connection.
@Module({
  imports: [EngineClientModule, GraphModule],
  providers: [OnboardingGraphService],
  exports: [OnboardingGraphService],
})
export class OnboardingModule {}
