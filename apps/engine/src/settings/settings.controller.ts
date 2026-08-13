import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  Announcement,
  UpdateAnnouncement,
  UpdateAnnouncementSchema,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('announcement')
  getAnnouncement(): Promise<Announcement> {
    return this.settings.getAnnouncement();
  }

  @Put('announcement')
  updateAnnouncement(
    @ZodBody(UpdateAnnouncementSchema) body: UpdateAnnouncement,
  ): Promise<Announcement> {
    return this.settings.updateAnnouncement(body);
  }
}
