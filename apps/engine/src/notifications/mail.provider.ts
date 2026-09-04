export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

/**
 * How the shop reaches a customer.
 *
 * A seam rather than a direct SES call for the reason the payment provider is
 * one: the whole path -- an order confirmed, a class booked, a piece back in
 * stock -- has to be exercisable in `pnpm docker:up`, where there is no mail
 * transport and no credential. The local provider records what would have been
 * sent; a real one is registered only when its configuration exists.
 *
 * Sending must never fail the thing that caused it. A confirmation email that
 * bounces is not a reason to lose an order.
 */
export interface MailProvider {
  send(input: MailInput): Promise<void>;
}
