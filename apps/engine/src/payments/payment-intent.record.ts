import { PaymentIntentState } from '@marketplace/contracts';

/**
 * What this shop knows about one payment attempt.
 *
 * The tenant is on the item's own partition key, which is what makes the
 * webhook route safe: it arrives unauthenticated and names an intent, and the
 * tenant is read from the record rather than from anything the caller said.
 */
export interface PaymentIntentRecord {
  entityType: 'PaymentIntent';
  intentId: string;
  orderId: string;
  tenantId: string;
  amountMinor: number;
  currency: string;
  state: PaymentIntentState;
  createdAt: string;
  settledAt?: string;
}
