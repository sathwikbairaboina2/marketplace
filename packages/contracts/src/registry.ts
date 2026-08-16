import { z } from 'zod';

export const FieldTypeSchema = z.enum([
  'string', 'number', 'boolean', 'date',
  'string[]', 'number[]', 'boolean[]', 'date[]',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'must be an identifier');

export const FieldDefinitionSchema = z.object({
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  default: z.unknown().nullable().default(null),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const EntitySchemaRecordSchema = z.object({
  version: z.number().int().nonnegative(),
  fields: z.record(FieldNameSchema, FieldDefinitionSchema),
});
export type EntitySchemaRecord = z.infer<typeof EntitySchemaRecordSchema>;

export const DynamicEntityTypeSchema = z.enum(['Product', 'Order', 'Event', 'Booking']);
export type DynamicEntityType = z.infer<typeof DynamicEntityTypeSchema>;

/**
 * Field names a tenant may not add, because the entity already has them.
 *
 * Dynamic fields live under `attributes`, so a collision cannot corrupt a
 * record -- but it is unusable at every layer above storage. A tenant who
 * asked for "a name field" got a second one called `name` and a form with two
 * inputs labelled "Name", indistinguishable to whoever fills it in, and no
 * route to remove it again.
 *
 * Reserved per entity rather than globally: `capacity` is structural to an
 * Event and meaningless to a Product, and a shop selling containers has every
 * right to describe one.
 */
const STRUCTURAL_FIELDS = ['id', 'entityType', 'createdAt', 'updatedAt', 'attributes', 'PK', 'SK', 'GSI1PK', 'GSI1SK'] as const;

const ENTITY_FIELDS: Record<DynamicEntityType, readonly string[]> = {
  Product: ['name', 'description', 'priceMinor', 'currency', 'category', 'stock', 'images', 'status'],
  Order: ['userId', 'status', 'totalAmountMinor', 'currency', 'items', 'shippingAddress'],
  Event: ['title', 'capacity', 'bookedCount', 'startDate', 'endDate', 'basePriceMinor', 'currency'],
  Booking: ['eventId', 'userId', 'status', 'ticketQuantity'],
};

export function reservedFieldNames(entity: DynamicEntityType): readonly string[] {
  return [...STRUCTURAL_FIELDS, ...ENTITY_FIELDS[entity]];
}

export const isReservedFieldName = (entity: DynamicEntityType, name: string): boolean =>
  reservedFieldNames(entity).includes(name);
