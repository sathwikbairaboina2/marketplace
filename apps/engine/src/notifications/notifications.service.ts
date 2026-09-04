import { Inject, Injectable, Logger } from '@nestjs/common';
import { MailKind, MailMessage, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { mailSk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { assertAdmin } from '../common/roles';
import { MAIL_PROVIDER, MailProvider } from './mail.provider';

/**
 * What the shop says to a customer, and the record that it said it.
 *
 * Until now this product had never sent anybody anything: the cart told a guest
 * to keep their order number because a web page was the only artefact of a
 * purchase. Two of the features that follow -- order history and back-in-stock
 * alerts -- stand on this.
 *
 * Every message is written to the tenant's own partition before it is handed to
 * the provider, so the merchant can answer "did she get it?" and so a local
 * stack can assert on the whole path without a mail transport.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repo: DynamoRepository,
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
  ) {}

  /**
   * Best effort, always. A confirmation that cannot be sent is not a reason to
   * lose the order that caused it, so this resolves even when the provider
   * throws -- the failure is logged and the record still exists.
   */
  async send(input: {
    kind: MailKind;
    to: string;
    subject: string;
    body: string;
    about?: string;
  }): Promise<void> {
    const id = newId();
    const record: MailMessage = {
      entityType: 'Mail',
      id,
      kind: input.kind,
      to: input.to,
      subject: input.subject,
      body: input.body,
      sentAt: new Date().toISOString(),
      ...(input.about ? { about: input.about } : {}),
    };

    try {
      await this.repo.put(mailSk(id), { ...record });
    } catch (err) {
      this.logger.error(`could not record ${input.kind} to ${input.to}`, err as Error);
      return;
    }

    try {
      await this.provider.send({ to: input.to, subject: input.subject, body: input.body });
    } catch (err) {
      this.logger.error(`could not send ${input.kind} to ${input.to}`, err as Error);
    }
  }

  /** The merchant's outbox. Admin only: it carries customers' addresses. */
  async list(limit: number, cursor: string | null): Promise<Page<MailMessage>> {
    assertAdmin('read the shop outbox');
    const page = await this.repo.queryPrefix<MailMessage & { PK: string; SK: string }>(
      skPrefix('Mail'),
      { limit, cursor },
    );
    return {
      items: page.items.map(({ PK: _pk, SK: _sk, ...rest }) => rest),
      nextCursor: page.nextCursor,
    };
  }
}
