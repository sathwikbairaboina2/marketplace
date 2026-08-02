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
