import { z } from 'zod';
import { DynamicEntityTypeSchema, FieldNameSchema, FieldTypeSchema } from './registry';

export const FlowStatusSchema = z.enum(['proposed', 'applied', 'rejected']);
export type FlowStatus = z.infer<typeof FlowStatusSchema>;

export const AddedFieldSchema = z.object({
  name: FieldNameSchema,
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  default: z.unknown().nullable().default(null),
});
export type AddedField = z.infer<typeof AddedFieldSchema>;

// .strict() is what makes this add-only: `removedFields` or `changedFields`
// are unrecognized keys and are rejected.
export const BlueprintDiffSchema = z
  .object({ addedFields: z.array(AddedFieldSchema).min(1) })
  .strict();
export type BlueprintDiff = z.infer<typeof BlueprintDiffSchema>;

export const CreateFlowSchema = z.object({
  targetEntity: DynamicEntityTypeSchema,
  actionType: z.literal('ADD_FIELDS'),
  blueprintDiff: BlueprintDiffSchema,
});
export type CreateFlow = z.infer<typeof CreateFlowSchema>;

export interface FlowRecord {
  PK: string;
  SK: string;
  entityType: 'Flow';
  id: string;
  targetEntity: string;
  actionType: 'ADD_FIELDS';
  status: FlowStatus;
  blueprintDiff: BlueprintDiff;
  createdAt: string;
  appliedAt: string | null;
  resultingVersion: number | null;
}
