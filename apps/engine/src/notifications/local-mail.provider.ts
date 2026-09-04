import { Injectable, Logger } from '@nestjs/common';
import { MailInput, MailProvider } from './mail.provider';

/**
 * The provider a local stack uses: it logs, and that is all.
 *
 * The *record* of the message is written by NotificationsService before this is
 * called, so an e2e test asserts on the outbox rather than on a transport. That
 * is deliberate -- a fake that pretended to deliver would be the one part of
 * the path never exercised against the real thing.
 */
@Injectable()
export class LocalMailProvider implements MailProvider {
  private readonly logger = new Logger(LocalMailProvider.name);

  async send(input: MailInput): Promise<void> {
    this.logger.log(`mail to ${input.to}: ${input.subject}`);
  }
}
