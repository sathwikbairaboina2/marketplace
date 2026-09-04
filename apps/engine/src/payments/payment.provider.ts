import { Card, PaymentIntentState } from '@marketplace/contracts';

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface ChargeInput {
  orderId: string;
  amountMinor: number;
  currency: string;
  card: Card;
}

export interface ChargeResult {
  paymentId: string;
  last4: string;
}

/** What the shop asks a gateway to collect, and from whom. */
export interface IntentInput {
  orderId: string;
  /**
   * Which shop this belongs to, handed to the gateway as its own metadata and
   * handed back on the webhook.
   *
   * A webhook arrives unauthenticated knowing only the gateway's id for the
   * attempt, and every read in this engine is scoped to a tenant partition --
   * so the tenant has to travel with the payment. Real gateways provide for
   * exactly this (Razorpay calls them `notes`), and it is round-tripped rather
   * than trusted: it names a partition, and a wrong one simply finds no intent.
   */
  tenantId: string;
  /** The printed reference, so the customer recognises the request. */
  reference: string;
  amountMinor: number;
  currency: string;
  /** The UPI id the shopper gave, when the shop collects one. */
  vpa?: string;
}

export interface IntentResult {
  intentId: string;
  state: PaymentIntentState;
  /** Where to send the customer to approve, when the gateway hosts that. */
  approvalUrl?: string;
}

/** What a verified webhook says happened. */
export interface PaymentEvent {
  /** The gateway's own id for this delivery, so a replay is recognisable. */
  eventId: string;
  intentId: string;
  /** The shop the attempt was started for; see `IntentInput.tenantId`. */
  tenantId: string;
  state: PaymentIntentState;
  amountMinor: number;
  paymentId?: string;
  /** How it was paid, for the receipt: a masked VPA or a card's last four. */
  instrumentLabel?: string;
}

/**
 * How money is taken.
 *
 * `charge` is the card path and is synchronous: the shopper is on the page
 * when it settles. Everything below it exists because UPI is not -- the
 * customer approves in their own banking app, seconds or minutes later, and
 * the truth arrives by webhook rather than as a return value.
 *
 * A provider is therefore three things: something that starts an attempt,
 * something that can verify a message claiming to be about one, and something
 * that can be *asked* about one -- because the last of those is the only
 * answer available when the webhook never comes.
 */
export interface PaymentProvider {
  /** A failed charge throws a ProblemException; success returns the receipt. */
  charge(input: ChargeInput): Promise<ChargeResult>;

  /** Start a collect request. Never returns a result: there is not one yet. */
  createIntent(input: IntentInput): Promise<IntentResult>;

  /**
   * Verify a webhook body against its signature and read the event out of it.
   * Returns null when the signature does not verify -- the caller answers the
   * same way whatever the reason, so nothing is learned from the response.
   *
   * Takes the *raw* bytes: a signature is over what was sent, and a body that
   * has been parsed and re-serialised is not that.
   */
  verifyWebhook(raw: string, signature: string | undefined): PaymentEvent | null;

  /** Ask the gateway what became of an attempt. The answer of last resort. */
  getIntent(intentId: string): Promise<PaymentEvent | null>;
}
