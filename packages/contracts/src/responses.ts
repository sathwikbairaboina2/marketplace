import { z } from 'zod';
import { AttributesSchema, CurrencySchema, IsoDateTimeSchema, UlidSchema } from './common';
import { ProductStatusSchema } from './product';
import { OrderStatusSchema } from './order';
import { BookingStatusSchema } from './booking';
import { BlueprintDiffSchema, FlowStatusSchema } from './flow';
import { MAX_STAGES, StageSchema } from './pipeline';
import { DynamicEntityTypeSchema, FieldDefinitionSchema, FieldNameSchema } from './registry';

// The engine's `*Response` types are `Omit<*Record, 'PK' | 'SK' | ...>` -- the
// DynamoDB keys are stripped, everything else survives, including
// `entityType`. `.strict()` here is what makes a leaked key attribute a test
// failure rather than a field the client silently ignores.

/** `{ items, nextCursor }` -- the shape every list endpoint returns. */
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const ProductResponseSchema = z
  .object({
    entityType: z.literal('Product'),
    id: UlidSchema,
    status: ProductStatusSchema,
    name: z.string(),
    description: z.string(),
    priceMinor: z.number().int(),
    currency: CurrencySchema,
    category: z.string(),
    stock: z.number().int(),
    images: z.array(z.string()),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

// Deliberately asymmetric with Product: EventRecord names the counter
// `bookedCount` and has no `updatedAt` at all.
export const EventResponseSchema = z
  .object({
    entityType: z.literal('Event'),
    id: UlidSchema,
    title: z.string(),
    capacity: z.number().int(),
    bookedCount: z.number().int(),
    startDate: IsoDateTimeSchema,
    endDate: IsoDateTimeSchema,
    basePriceMinor: z.number().int(),
    currency: CurrencySchema,
    createdAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type EventResponse = z.infer<typeof EventResponseSchema>;

export const OrderLineItemSchema = z
  .object({
    productId: UlidSchema,
    quantity: z.number().int(),
    unitPriceMinor: z.number().int(),
  })
  .strict();
// No inferred type export: `OrderLineItem` is already the interface declared in
// `./order`, and re-exporting a second one under the same name from the
// package index would be a duplicate export.

export const OrderResponseSchema = z
  .object({
    entityType: z.literal('Order'),
    id: UlidSchema,
    userId: z.string(),
    status: OrderStatusSchema,
    totalAmountMinor: z.number().int(),
    currency: CurrencySchema,
    items: z.array(OrderLineItemSchema),
    shippingAddress: z.record(z.string(), z.string()),
    createdAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
    // The stage list this order was placed under, copied at write time. A later
    // rename or reorder by the owner publishes a new pipeline version and never
    // touches this snapshot -- the same argument `unitPriceMinor` makes for price.
    pipelineVersion: z.number().int().nonnegative(),
    stages: z.array(StageSchema).min(1).max(MAX_STAGES),
    currentStageId: z.string(),
    stageEnteredAt: IsoDateTimeSchema,
  })
  .strict();
export type OrderResponse = z.infer<typeof OrderResponseSchema>;

export const BookingResponseSchema = z
  .object({
    entityType: z.literal('Booking'),
    id: UlidSchema,
    eventId: UlidSchema,
    userId: z.string(),
    status: BookingStatusSchema,
    ticketQuantity: z.number().int(),
    createdAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type BookingResponse = z.infer<typeof BookingResponseSchema>;

export const FlowResponseSchema = z
  .object({
    entityType: z.literal('Flow'),
    id: UlidSchema,
    targetEntity: DynamicEntityTypeSchema,
    actionType: z.literal('ADD_FIELDS'),
    status: FlowStatusSchema,
    blueprintDiff: BlueprintDiffSchema,
    createdAt: IsoDateTimeSchema,
    proposedBy: z.string(),
    executedBy: z.string().nullable(),
    appliedAt: IsoDateTimeSchema.nullable(),
    resultingVersion: z.number().int().nullable(),
  })
  .strict();
export type FlowResponse = z.infer<typeof FlowResponseSchema>;

/** What `GET /me` returns -- mirrors `TenantPrincipal` in `@marketplace/auth`. */
export const PrincipalSchema = z
  .object({ tenantId: z.string(), userId: z.string(), role: z.string().nullable() })
  .strict();
export type Principal = z.infer<typeof PrincipalSchema>;

export const SchemaViewSchema = z
  .object({
    entityType: DynamicEntityTypeSchema,
    version: z.number().int().nonnegative(),
    fields: z.record(FieldNameSchema, FieldDefinitionSchema),
  })
  .strict();
export type SchemaView = z.infer<typeof SchemaViewSchema>;

export const SchemaListSchema = z.object({ items: z.array(SchemaViewSchema) }).strict();
export type SchemaList = z.infer<typeof SchemaListSchema>;
