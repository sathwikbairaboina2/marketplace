import { Injectable } from '@nestjs/common';
import { MAGIC_CARD } from '@marketplace/contracts';
import { randomUUID } from 'node:crypto';
import { ProblemException } from '../common/problem';
import {
  ChargeInput,
  ChargeResult,
  IntentInput,
  IntentResult,
  PaymentEvent,
  PaymentProvider,
} from './payment.provider';

/**
 * Deterministic, offline, Stripe-shaped. The card number selects the outcome;
 * format validity is the schema's job, so anything arriving here is already
 * Luhn-valid. 402 Payment Required for both refusal modes.
 */
@Injectable()
export class FakeCardProvider implements PaymentProvider {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const number = input.card.number;
    if (number === MAGIC_CARD.declined) {
      throw new ProblemException(
        'payment-declined',
        402,
        'Card declined',
        'the card was declined; try a different card',
      );
    }
    if (number === MAGIC_CARD.insufficientFunds) {
      throw new ProblemException(
        'insufficient-funds',
        402,
        'Insufficient funds',
        'the card cannot cover this amount; try a different card',
      );
    }
    return { paymentId: `fake_${randomUUID()}`, last4: number.slice(-4) };
  }

  /**
   * Cards only. A provider that cannot collect asynchronously says so rather
   * than pretending to start something nobody will ever settle -- 502, because
   * nothing was attempted and a retry elsewhere is the honest advice.
   */
  async createIntent(_input: IntentInput): Promise<IntentResult> {
    throw new ProblemException(
      'payment-provider-unavailable',
      502,
      'UPI is not available',
      'this shop is configured for card payments only',
    );
  }

  verifyWebhook(_raw: string, _signature: string | undefined): PaymentEvent | null {
    return null;
  }

  async getIntent(_intentId: string): Promise<PaymentEvent | null> {
    return null;
  }
}
