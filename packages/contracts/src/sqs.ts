import { z } from 'zod';
import { BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';

export const EngineJobMessageSchema = z.object({
  action: z.literal('PROPOSE_FLOW'),
  targetEntity: DynamicEntityTypeSchema,
  tenantId: z.string().min(1),
  payload: BlueprintDiffSchema,
  metadata: z.object({ threadId: z.string() }).passthrough(),
});
export type EngineJobMessage = z.infer<typeof EngineJobMessageSchema>;
