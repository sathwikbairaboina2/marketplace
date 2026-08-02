import { z } from 'zod';

export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code');
export const MinorAmountSchema = z.number().int().nonnegative();
export const IsoDateTimeSchema = z.string().datetime();
export const AttributesSchema = z.record(z.string(), z.unknown());

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
