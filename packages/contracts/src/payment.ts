import { z } from 'zod';
import { IsoDateTimeSchema, MinorAmountSchema } from './common';

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

/** What is stored on the order. Deliberately no card number field. */
export const PaymentSchema = z.object({
  id: z.string(),
  last4: z.string().regex(/^\d{4}$/),
  amountMinor: MinorAmountSchema,
  at: IsoDateTimeSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;
