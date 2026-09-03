import { z } from 'zod';
import { CurrencySchema, MAX_QUANTITY, MinorAmountSchema, QuantitySchema, StockSchema, UlidSchema } from './common';
import { CreateOrderSchema } from './order';

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

/**
 * POST /checkout body: everything CreateOrder needs except items, which come
 * from the caller's server-side cart.
 */
export const CheckoutRequestSchema = CreateOrderSchema.omit({ items: true });
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;

/** A stranger's checkout: the same facts plus the one thing that lets them find the order again. */
export const GuestCheckoutRequestSchema = CheckoutRequestSchema.extend({
  email: z.string().trim().toLowerCase().email().max(254),
}).strict();
export type GuestCheckoutRequest = z.infer<typeof GuestCheckoutRequestSchema>;

/** Body of POST /shops/:tenantId/guest's answer: an opaque ticket for X-Guest. */
export const GuestTokenResponseSchema = z.object({ guest: z.string().min(1) }).strict();
export type GuestTokenResponse = z.infer<typeof GuestTokenResponseSchema>;

/** Body of POST /cart/merge: the ticket a signed-in buyer carried as a stranger. */
export const MergeCartSchema = z.object({ guest: z.string().min(1).max(200) }).strict();
export type MergeCart = z.infer<typeof MergeCartSchema>;
