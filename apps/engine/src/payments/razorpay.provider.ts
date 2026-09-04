import { createHmac, timingSafeEqual } from 'node:crypto';
import { Card, PaymentIntentState } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import {
  ChargeInput,
  ChargeResult,
  IntentInput,
  IntentResult,
  PaymentEvent,
  PaymentProvider,
} from './payment.provider';

const API = 'https://api.razorpay.com/v1';

/**
 * Razorpay, written against the documented API.
 *
 * **This has never spoken to Razorpay.** It is registered only where
 * credentials exist, and no credentials exist in this repository or in any
 * local stack — every test in this project runs against `LocalUpiProvider`,
 * which is deliberately built to exercise the same paths. Treat the field
 * names below as read off the documentation, not as verified against a live
 * account, and expect the first real call to correct something here.
 *
 * What it does *not* do is invent behaviour the local provider does not also
 * have: both round-trip the tenant through the gateway's own metadata, both
 * verify an HMAC over the raw bytes, and both answer `getIntent` so the
 * reconciliation poll has something to ask when a webhook never arrives.
 */
export class RazorpayProvider implements PaymentProvider {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  private get authorization(): string {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;
  }

  /**
   * Cards go through the same gateway in production, but this service never
   * sees a card number: Razorpay's own checkout collects it. Refused here
   * rather than half-implemented.
   */
  async charge(_input: ChargeInput & { card: Card }): Promise<ChargeResult> {
    throw new ProblemException(
      'payment-provider-unavailable',
      502,
      'Card payments are not configured',
      'this shop collects by UPI',
    );
  }

  async createIntent(input: IntentInput): Promise<IntentResult> {
    const res = await fetch(`${API}/payment_links`, {
      method: 'POST',
      headers: { authorization: this.authorization, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        accept_partial: false,
        reference_id: input.reference,
        description: `Order ${input.reference}`,
        // Round-tripped on the webhook. The tenant has to travel with the
        // payment: a webhook arrives unauthenticated, and every read in this
        // engine is scoped to a tenant partition.
        notes: { tenantId: input.tenantId, orderId: input.orderId },
        upi_link: true,
        ...(input.vpa ? { customer: { contact: '', email: '', name: input.vpa } } : {}),
      }),
    }).catch(() => null);

    if (!res || !res.ok) {
      throw new ProblemException(
        'payment-provider-unavailable',
        502,
        'The payment service did not answer',
        'nothing was charged; try again in a moment',
      );
    }

    const body = (await res.json()) as { id: string; short_url?: string };
    return { intentId: body.id, state: 'pending', approvalUrl: body.short_url };
  }

  /**
   * `X-Razorpay-Signature` is an HMAC-SHA256 of the raw body under the webhook
   * secret. Compared in constant time: a check that returns early on the first
   * wrong byte tells an attacker how much of a guess was right.
   */
  verifyWebhook(raw: string, signature: string | undefined): PaymentEvent | null {
    if (!signature) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(raw).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    try {
      const body = JSON.parse(raw) as {
        id?: string;
        event?: string;
        payload?: {
          payment?: {
            entity?: {
              id?: string;
              amount?: number;
              status?: string;
              vpa?: string;
              notes?: { tenantId?: string };
            };
          };
          payment_link?: { entity?: { id?: string; notes?: { tenantId?: string } } };
        };
      };
      const payment = body.payload?.payment?.entity;
      const link = body.payload?.payment_link?.entity;
      const tenantId = payment?.notes?.tenantId ?? link?.notes?.tenantId;
      const intentId = link?.id;
      if (!body.id || !tenantId || !intentId) return null;

      return {
        eventId: body.id,
        intentId,
        tenantId,
        state: stateFrom(body.event, payment?.status),
        amountMinor: payment?.amount ?? 0,
        paymentId: payment?.id,
        instrumentLabel: payment?.vpa,
      };
    } catch {
      return null;
    }
  }

  async getIntent(intentId: string): Promise<PaymentEvent | null> {
    const res = await fetch(`${API}/payment_links/${encodeURIComponent(intentId)}`, {
      headers: { authorization: this.authorization },
    }).catch(() => null);
    if (!res || !res.ok) return null;

    const body = (await res.json()) as {
      id: string;
      status?: string;
      amount_paid?: number;
      amount?: number;
      notes?: { tenantId?: string };
    };
    if (!body.notes?.tenantId) return null;

    return {
      // Derived, not the gateway's: a poll is not a delivery, and giving it a
      // stable id of its own is what lets the dedupe treat one settlement seen
      // twice -- once polled, once delivered -- as one event.
      eventId: `poll_${body.id}`,
      intentId: body.id,
      tenantId: body.notes.tenantId,
      state: stateFrom(undefined, body.status),
      amountMinor: body.amount_paid || body.amount || 0,
    };
  }
}

function stateFrom(event: string | undefined, status: string | undefined): PaymentIntentState {
  if (event === 'payment.captured' || status === 'captured' || status === 'paid') return 'paid';
  if (event === 'payment.failed' || status === 'failed') return 'failed';
  if (status === 'expired' || status === 'cancelled') return 'expired';
  return 'pending';
}
