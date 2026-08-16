import { z } from 'zod';
import {
  DynamicEntityTypeSchema,
  FieldNameSchema,
  FieldTypeSchema,
  isReservedFieldName,
  type DynamicEntityType,
} from './registry';

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

/**
 * Applied wherever a diff meets the entity it targets -- here and on the queue
 * message the agents service sends -- because the reservation depends on which
 * entity is being extended, and `BlueprintDiffSchema` alone does not know.
 */
export function refuseReservedFieldNames(
  value: { targetEntity: DynamicEntityType; blueprintDiff: BlueprintDiff },
  ctx: z.RefinementCtx,
): void {
  value.blueprintDiff.addedFields.forEach((field, index) => {
    if (isReservedFieldName(value.targetEntity, field.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['blueprintDiff', 'addedFields', index, 'name'],
        message: `${value.targetEntity} already has a field called ${field.name}`,
      });
    }
  });
}

export const CreateFlowSchema = z
  .object({
    targetEntity: DynamicEntityTypeSchema,
    actionType: z.literal('ADD_FIELDS'),
    blueprintDiff: BlueprintDiffSchema,
  })
  .strict()
  .superRefine(refuseReservedFieldNames);
export type CreateFlow = z.infer<typeof CreateFlowSchema>;

export interface FlowRecord {
  PK: string;
  SK: string;
  entityType: 'Flow';
  id: string;
  // Narrower than `string`: `CreateFlowSchema` already rejects anything that
  // is not a dynamic entity type, and widening it here would force every
  // consumer of a stored flow to re-narrow a value that cannot vary.
  targetEntity: DynamicEntityType;
  actionType: 'ADD_FIELDS';
  status: FlowStatus;
  blueprintDiff: BlueprintDiff;
  createdAt: string;
  // A Flow permanently mutates the tenant's data model with no per-record ownership check
  // (any authenticated member of the tenant may propose or execute one), so these are the only
  // record of who did it -- `proposedBy` is the principal's `userId` on `POST /flows` (or the
  // SQS consumer's system identity for an AI-proposed flow), `executedBy` is the principal's
  // `userId` on `POST /flows/:id/execute`, null until executed.
  proposedBy: string;
  executedBy: string | null;
  appliedAt: string | null;
  resultingVersion: number | null;
}
