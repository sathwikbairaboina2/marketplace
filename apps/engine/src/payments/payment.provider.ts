import { Card } from '@marketplace/contracts';

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

/** A failed charge throws a ProblemException; success returns the receipt. */
export interface PaymentProvider {
  charge(input: ChargeInput): Promise<ChargeResult>;
}
