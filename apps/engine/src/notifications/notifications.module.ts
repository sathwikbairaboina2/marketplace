import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { LocalMailProvider } from './local-mail.provider';
import { MAIL_PROVIDER } from './mail.provider';

/**
 * One binding, chosen here. A real transport registers in place of the local
 * one when its configuration exists -- the posture the media bucket already
 * uses -- so nothing above this module knows which is in play.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, { provide: MAIL_PROVIDER, useClass: LocalMailProvider }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
