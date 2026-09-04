import { MailMessageSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(MailMessageSchema);

/** The shop's outbox. Admin only: it carries customers' addresses. */
export const listNotifications = (limit: number, cursor: string | null) =>
  request('/notifications', { query: { limit, cursor: cursor ?? undefined }, schema: Page });
