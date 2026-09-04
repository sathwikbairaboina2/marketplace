import { z } from 'zod';
import { IsoDateTimeSchema, TotalMinorAmountSchema } from './common';

export const normalizeCardNumber = (raw: string): string => raw.replace(/[\s-]/g, '');

/** Standard Luhn checksum over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Magic numbers, Stripe test-card style. The provider selects the outcome;
 * the schema only guarantees the number is well-formed.
 */
export const MAGIC_CARD = {
  success: '4242424242424242',
  declined: '4000000000000002',
  insufficientFunds: '4000000000009995',
} as const;

export const CardSchema = z.object({
  number: z
    .string()
    .transform(normalizeCardNumber)
    .refine(luhnValid, 'not a valid card number'),
  expMonth: z.number().int().min(1).max(12),
  expYear: z.number().int().min(2020).max(2100),
  cvc: z.string().regex(/^\d{3,4}$/, 'must be 3 or 4 digits'),
});
export type Card = z.infer<typeof CardSchema>;

export const PayRequestSchema = z.object({ card: CardSchema });
export type PayRequest = z.infer<typeof PayRequestSchema>;

/**
 * A guest paying. The email is the same key `POST orders/lookup` takes, and it
 * is here because the ticket is not a durable key to an order: a stranger who
 * signs in, clears storage or comes back in another browser holds a different
 * guest id, and without this the order they were about to pay for becomes
 * unpayable by any route while its stock stays reserved. Optional, because a
 * guest still holding the ticket they checked out with needs nothing extra.
 */
export const GuestPayRequestSchema = PayRequestSchema.extend({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
});
export type GuestPayRequest = z.infer<typeof GuestPayRequestSchema>;

/** The same escape hatch for the cancel a guest is entitled to. */
export const GuestCancelRequestSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254).optional() })
  .strict();
export type GuestCancelRequest = z.infer<typeof GuestCancelRequestSchema>;

/** What is stored on the order. Deliberately no card number field. */
export const PaymentSchema = z.object({
  id: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  // The order total, not a line-item price: `MinorAmountSchema` caps at
  // MAX_MINOR_AMOUNT (1e10) while a total may legitimately reach 5e15 by the
  // arithmetic set out in common.ts. The engine could write a payment its own
  // strict response schema then refused to parse -- a paid order whose page
  // breaks. Bounded by what the total is bounded by.
  amountMinor: TotalMinorAmountSchema,
  at: IsoDateTimeSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;
