import { z } from 'zod';
import { CurrencySchema, MAX_QUANTITY, MinorAmountSchema, QuantitySchema, StockSchema, UlidSchema } from './common';

export const MAX_CART_LINES = 50;

/** What the client sends: identity and quantity only. The server owns prices. */
export const CartLineSchema = z.object({
  productId: UlidSchema,
  qty: QuantitySchema,
});
export type CartLine = z.infer<typeof CartLineSchema>;

/** Body of PUT /cart/lines/:productId. qty 0 removes the line. */
export const PutCartLineSchema = z.object({
  qty: z.number().int().nonnegative().max(MAX_QUANTITY),
});
export type PutCartLine = z.infer<typeof PutCartLineSchema>;

/** A line as the server returns it: resolved against the live product. */
export const ResolvedCartLineSchema = z.object({
  productId: UlidSchema,
  qty: QuantitySchema,
  name: z.string(),
  unitPriceMinor: MinorAmountSchema,
  currency: CurrencySchema,
  image: z.string().nullable(),
  stock: StockSchema,
  /** True when the product is archived/inactive or gone: rendered struck-through, refused at checkout. */
  unavailable: z.boolean(),
});
export type ResolvedCartLine = z.infer<typeof ResolvedCartLineSchema>;

export const CartResponseSchema = z.object({
  lines: z.array(ResolvedCartLineSchema).max(MAX_CART_LINES),
  /** Server-computed sum over available lines, integer minor units. */
  totalMinor: z.number().int().nonnegative(),
});
export type CartResponse = z.infer<typeof CartResponseSchema>;
