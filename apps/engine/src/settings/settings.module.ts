import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  // The public shop surface reads the announcement through this service.
  exports: [SettingsService],
})
export class SettingsModule {}
