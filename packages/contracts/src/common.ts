import { z } from 'zod';

export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code');

// Bounds chosen so that the worst-case order total -- MAX_ORDER_LINE_ITEMS (50) line items, each
// at the maximum unit price times the maximum quantity -- cannot leave the range JavaScript
// numbers can represent as an exact integer:
//
//   MAX_MINOR_AMOUNT * MAX_QUANTITY * 50 = 10_000_000_000 * 10_000 * 50
//                                         = 5_000_000_000_000_000  (5e15)
//
// which stays comfortably under Number.MAX_SAFE_INTEGER (9_007_199_254_740_991, ~9.007e15) --
// about 1.8x headroom -- so `totalAmountMinor`'s `reduce`-in-JS-floats arithmetic can never
// silently drift past exact-integer precision. MAX_MINOR_AMOUNT alone (1e10 minor units) is
// already far beyond any real price -- 100 million units of a 2-decimal currency -- and
// MAX_QUANTITY (10,000) comfortably covers bulk ordering without being unbounded.
export const MAX_MINOR_AMOUNT = 10_000_000_000;
export const MAX_QUANTITY = 10_000;

export const MinorAmountSchema = z.number().int().nonnegative().max(MAX_MINOR_AMOUNT);
export const QuantitySchema = z.number().int().positive().max(MAX_QUANTITY);
export const StockSchema = z.number().int().nonnegative().max(MAX_QUANTITY);
export const IsoDateTimeSchema = z.string().datetime();
export const AttributesSchema = z.record(z.string(), z.unknown());

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
