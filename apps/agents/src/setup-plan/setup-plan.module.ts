import { Module } from '@nestjs/common';
import { SetupPlanController } from './setup-plan.controller';
import { SetupPlanService } from './setup-plan.service';

// EngineClientModule and DispatchModule are both @Global(), so the two
// dependencies arrive without being imported here.
@Module({
  controllers: [SetupPlanController],
  providers: [SetupPlanService],
})
export class SetupPlanModule {}
