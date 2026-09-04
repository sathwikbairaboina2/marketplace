import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  Announcement,
  DepositPolicy,
  ShopContact,
  UpdateAnnouncement,
  UpdateAnnouncementSchema,
  UpdateDepositPolicy,
  UpdateDepositPolicySchema,
  UpdateShopContact,
  UpdateShopContactSchema,
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

  @Get('contact')
  getContact(): Promise<ShopContact> {
    return this.settings.getContact();
  }

  @Put('contact')
  @Roles('admin')
  updateContact(
    @ZodBody(UpdateShopContactSchema) body: UpdateShopContact,
  ): Promise<ShopContact> {
    return this.settings.updateContact(body);
  }

  @Get('deposit')
  getDepositPolicy(): Promise<DepositPolicy> {
    return this.settings.getDepositPolicy();
  }

  @Put('deposit')
  @Roles('admin')
  updateDepositPolicy(
    @ZodBody(UpdateDepositPolicySchema) body: UpdateDepositPolicy,
  ): Promise<DepositPolicy> {
    return this.settings.updateDepositPolicy(body);
  }
}
