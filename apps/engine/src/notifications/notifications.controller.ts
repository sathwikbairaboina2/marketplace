import { Controller, Get, Query } from '@nestjs/common';
import { MailMessage, Page } from '@marketplace/contracts';
import { Roles } from '../auth/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * The shop's outbox. Admin only, and checked in the service too: it carries
   * customers' email addresses, and the decorator is what makes that visible
   * in the OpenAPI document.
   */
  @Get()
  @Roles('admin')
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<MailMessage>> {
    const size = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.notifications.list(size, cursor ?? null);
  }
}
