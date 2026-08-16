import { z } from 'zod';
import { refuseReservedFieldNames, BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';

export const EngineJobMessageSchema = z.object({
  action: z.literal('PROPOSE_FLOW'),
  targetEntity: DynamicEntityTypeSchema,
  tenantId: z.string().min(1),
  payload: BlueprintDiffSchema,
  metadata: z.object({ threadId: z.string() }).passthrough(),
}).superRefine((value, ctx) =>
  // The same reservation as CreateFlowSchema: a proposal reaching the engine
  // over the queue must not be able to add a field the entity already has,
  // whichever service composed it.
  refuseReservedFieldNames(
    { targetEntity: value.targetEntity, blueprintDiff: value.payload },
    ctx,
  ),
);
export type EngineJobMessage = z.infer<typeof EngineJobMessageSchema>;
