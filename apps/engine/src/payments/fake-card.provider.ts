import { Injectable } from '@nestjs/common';
import { MAGIC_CARD } from '@marketplace/contracts';
import { randomUUID } from 'node:crypto';
import { ProblemException } from '../common/problem';
import { ChargeInput, ChargeResult, PaymentProvider } from './payment.provider';

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
}
