import { z } from 'zod';
import { AttributesSchema, CurrencySchema, QuantitySchema, UlidSchema } from './common';

export const OrderStatusSchema = z.enum(['pending', 'confirmed', 'cancelled']);
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
}
