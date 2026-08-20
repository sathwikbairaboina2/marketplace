import { z } from 'zod';
import { AttributesSchema, CurrencySchema, QuantitySchema, UlidSchema } from './common';
import type { Stage } from './pipeline';

export const OrderStatusSchema = z.enum(['pending', 'confirmed', 'cancelled', 'awaiting_payment']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const MAX_ORDER_LINE_ITEMS = 50;

export const CreateOrderSchema = z
  .object({
    items: z
      .array(z.object({ productId: UlidSchema, quantity: QuantitySchema }))
      .min(1),
    currency: CurrencySchema,
    shippingAddress: z.record(z.string(), z.string()),
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
  createdAt: string;
  attributes: Record<string, unknown>;
  // Optional on the stored record, required on the response: orders written
  // before stages existed have none of these, and `toResponse` fills them from
  // DEFAULT_PIPELINE rather than a migration backfilling the table.
  pipelineVersion?: number;
  stages?: Stage[];
  currentStageId?: string | null;
  stageEnteredAt?: string;
}
