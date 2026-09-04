import { z } from 'zod';
import { AttributesSchema, CurrencySchema, QuantitySchema, UlidSchema } from './common';
import type { Stage } from './pipeline';

export const OrderStatusSchema = z.enum(['pending', 'confirmed', 'cancelled', 'awaiting_payment']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const MAX_ORDER_LINE_ITEMS = 50;

/**
 * How the goods reach the buyer. Half this merchant's orders are collected at
 * the studio, and checkout used to force a delivery address on them -- so they
 * typed a fake one, and the address on the order was a lie.
 */
export const FulfilmentSchema = z.enum(['delivery', 'collection']);
export type Fulfilment = z.infer<typeof FulfilmentSchema>;

export const CreateOrderSchema = z
  .object({
    items: z
      .array(z.object({ productId: UlidSchema, quantity: QuantitySchema }))
      .min(1),
    currency: CurrencySchema,
    // Still a bare record, and `shippingAddress` still required in shape: a
    // `.superRefine` here would return a ZodEffects, and `CheckoutRequestSchema`
    // is built by `.omit()` on this object -- which ZodEffects does not have.
    // A collection order sends the buyer's name and number and no address.
    shippingAddress: z.record(z.string(), z.string()),
    fulfilment: FulfilmentSchema.default('delivery'),
    /**
     * The buyer asking to pay a deposit now and the balance on collection or
     * delivery. Honoured only if the shop offers one for an order this size;
     * the engine decides the amount, never the client.
     */
    deposit: z.boolean().default(false),
    attributes: AttributesSchema.default({}),
  })
  .strict();
export type CreateOrder = z.infer<typeof CreateOrderSchema>;

/**
 * The stage the seller was looking at when they clicked. Sent so the engine can
 * condition the write on it: a stale page must not be able to skip a stage.
 */
export const AdvanceOrderSchema = z.object({ currentStageId: z.string() }).strict();
export type AdvanceOrder = z.infer<typeof AdvanceOrderSchema>;

/**
 * The order number a shopper reads back over the phone. Derived from the
 * ULID's random tail rather than a per-tenant counter: a counter is a
 * contended write on the hot path of every checkout, and the point of the
 * complaint was that `01M1NW5KEMAH79GE53SQYQ65WQ` cannot be dictated, not that
 * it was not sequential.
 *
 * Eight Crockford-base32 characters in two groups, from an alphabet that
 * already excludes I, L, O and U. Normalisation folds the ambiguous glyphs a
 * person types back to what was stored, so `o` reads as `0` and a missing
 * dash costs nobody their order.
 */
export const ORDER_REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export function orderReferenceFrom(id: string): string {
  const tail = id.slice(-8).toUpperCase();
  return `${tail.slice(0, 4)}-${tail.slice(4)}`;
}

export function normalizeOrderReference(input: string): string {
  const bare = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0')
    .replace(/U/g, 'V');
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}

/** How a guest finds an order again: the id from the confirmation page and the email they gave. */
export const OrderLookupSchema = z
  .object({
    // Either form: the reference printed on the confirmation, or the full id a
    // shopper who bookmarked the URL already has. One field, because a shopper
    // asked for "your order number" should not have to know which kind theirs
    // is.
    orderId: z.union([UlidSchema, z.string().trim().transform(normalizeOrderReference).pipe(z.string().regex(ORDER_REFERENCE_PATTERN))]),
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();
export type OrderLookup = z.infer<typeof OrderLookupSchema>;

export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface OrderRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'Order';
  id: string;
  userId: string;
  status: OrderStatus;
  totalAmountMinor: number;
  currency: string;
  items: OrderLineItem[];
  shippingAddress: Record<string, string>;
  /** Absent on orders placed before collection existed: they were deliveries. */
  fulfilment?: Fulfilment;
  /**
   * What is still owed, in minor units, when the shop took a deposit. Zero or
   * absent on an ordinary order. The order's `status` is deliberately
   * untouched: `partly_paid` would reach thirteen readers of the enum and four
   * of them fail silently -- revenue would quietly lose the order.
   */
  balanceDueMinor?: number;
  createdAt: string;
  attributes: Record<string, unknown>;
  /** Present on a guest's order only: the address they gave to find it again. */
  guestEmail?: string;
  /** Optional on the record for the same reason the stage fields are. */
  reference?: string;
  // Optional on the stored record, required on the response: orders written
  // before stages existed have none of these, and `toResponse` fills them from
  // DEFAULT_PIPELINE rather than a migration backfilling the table.
  pipelineVersion?: number;
  stages?: Stage[];
  currentStageId?: string | null;
  stageEnteredAt?: string;
}

/**
 * How a shop knows a returning customer without an account.
 *
 * This product deliberately has no sign-up route, so identity is whatever the
 * buyer typed at checkout. Both are normalised hard before they are hashed: a
 * phone number is written a dozen ways and an address is case-insensitive, and
 * a customer who types either differently next time must still be the same
 * person.
 *
 * A phone number is the primary handle because that is what this merchant's
 * customers actually are -- she looks people up by number, not by address.
 */
export function normalizeEmailHandle(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}

export function normalizePhoneHandle(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // The last ten digits: the same number reaches her as 98765 43210,
  // +91 98765 43210 and 098765 43210, and all three are one customer.
  return `phone:${digits.length > 10 ? digits.slice(-10) : digits}`;
}

/** Looking a customer up: one handle or the other, never both. */
export const CustomerLookupSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    phone: z.string().trim().min(4).max(32).optional(),
  })
  .strict()
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'a phone number or an email address',
  });
export type CustomerLookup = z.infer<typeof CustomerLookupSchema>;

/** A returning customer asking what they have bought here, by address alone. */
export const GuestHistorySchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();
export type GuestHistory = z.infer<typeof GuestHistorySchema>;
