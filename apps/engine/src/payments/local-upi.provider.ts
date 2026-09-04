import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { ENV, EnvConfig } from '../config/env.schema';
import {
  ChargeInput,
  ChargeResult,
  IntentInput,
  IntentResult,
  PaymentEvent,
  PaymentProvider,
} from './payment.provider';
import { FakeCardProvider } from './fake-card.provider';

/** A UPI id that selects an outcome, the way a magic card number does. */
export const MAGIC_VPA = {
  /** Approves as soon as the stand-in page is used. */
  paid: 'success@local',
  /** Refuses, the way a customer declining in their app does. */
  declined: 'declined@local',
  /**
   * Captures and never sends a webhook. The only way to exercise the
   * reconciliation poll, which otherwise has no test that can reach it.
   */
  silent: 'silent@local',
} as const;

/**
 * The gateway a local stack talks to.
 *
 * It is not a stub that marks the order paid. It writes an intent, hands the
 * browser a page in this app that stands in for a banking app, and that page
 * signs a payload and posts it to the engine's *real* webhook route. So
 * signature verification, replay dedupe, the amount re-check and the
 * conditional write are all exercised by every local run -- the part that is
 * never tested against the real thing is as small as it can be made.
 */
@Injectable()
export class LocalUpiProvider implements PaymentProvider {
  private readonly intents = new Map<string, PaymentEvent>();
  private readonly cards = new FakeCardProvider();

  constructor(@Inject(ENV) private readonly env: EnvConfig) {}

  charge(input: ChargeInput): Promise<ChargeResult> {
    return this.cards.charge(input);
  }

  async createIntent(input: IntentInput): Promise<IntentResult> {
    const intentId = `upi_${randomUUID()}`;
    const vpa = input.vpa?.trim().toLowerCase();
    this.intents.set(intentId, {
      eventId: `evt_${randomUUID()}`,
      intentId,
      tenantId: input.tenantId,
      state: vpa === MAGIC_VPA.declined ? 'failed' : 'paid',
      amountMinor: input.amountMinor,
      paymentId: `pay_${randomUUID()}`,
      instrumentLabel: vpa ?? 'someone@upi',
    });

    return {
      intentId,
      state: 'pending',
      // The stand-in for a banking app. `silent@local` is given no way to
      // approve, which is the point of it.
      approvalUrl:
        vpa === MAGIC_VPA.silent
          ? undefined
          : `/pay/approve?intent=${encodeURIComponent(intentId)}`,
    };
  }

  /**
   * The same shape a real gateway uses: an HMAC over the exact bytes sent.
   * Compared in constant time -- a signature check that returns early on the
   * first wrong byte tells an attacker how much of their guess was right.
   */
  verifyWebhook(raw: string, signature: string | undefined): PaymentEvent | null {
    if (!signature) return null;
    const expected = createHmac('sha256', this.env.PAYMENT_WEBHOOK_SECRET).update(raw).digest();
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'hex');
    } catch {
      return null;
    }
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    try {
      return JSON.parse(raw) as PaymentEvent;
    } catch {
      return null;
    }
  }

  /** What the gateway would say if asked. The answer the poll relies on. */
  async getIntent(intentId: string): Promise<PaymentEvent | null> {
    return this.intents.get(intentId) ?? null;
  }

  /** Used by the stand-in approval page to sign what it is about to post. */
  sign(raw: string): string {
    return createHmac('sha256', this.env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex');
  }
}
