import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  Announcement,
  UpdateAnnouncement,
  UpdateAnnouncementSchema,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('announcement')
  getAnnouncement(): Promise<Announcement> {
    return this.settings.getAnnouncement();
  }

  // Declared here as well as checked in the service. The service check is what
  // the unit tests pin and what protects any future non-HTTP caller; the
  // decorator is what makes the restriction visible on the route and in the
  // OpenAPI document, alongside every other admin-only write.
  @Put('announcement')
  @Roles('admin')
  updateAnnouncement(
    @ZodBody(UpdateAnnouncementSchema) body: UpdateAnnouncement,
  ): Promise<Announcement> {
    return this.settings.updateAnnouncement(body);
  }
}
