import { z } from 'zod';
import { UlidSchema } from './common';

/**
 * How many stages one shop may define. Bounded for the same reason
 * MAX_ORDER_LINE_ITEMS is: the list renders as a tracker on the buyer's order
 * page and is copied onto every order placed under it.
 */
export const MAX_STAGES = 12;

const StageNameSchema = z.string().trim().min(1).max(60);

export const StageSchema = z
  .object({
    // A stage's identity is this ULID, never its name -- a rename must not
    // orphan the stage's messages or the orders pinned to it.
    id: UlidSchema,
    name: StageNameSchema,
    cancellable: z.boolean().default(false),
    messaging: z.boolean().default(false),
  })
  .strict();
export type Stage = z.infer<typeof StageSchema>;

export const PipelineSchema = z
  .object({
    // 0 means "never configured" -- the built-in default. A real save starts at 1.
    version: z.number().int().nonnegative(),
    stages: z.array(StageSchema).min(1).max(MAX_STAGES),
  })
  .strict();
export type Pipeline = z.infer<typeof PipelineSchema>;

/** Absent `id` means "a stage being added"; the service mints the ULID. */
export const StageInputSchema = StageSchema.extend({ id: UlidSchema.optional() });
export type StageInput = z.infer<typeof StageInputSchema>;

const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Two stages labelled the same thing is bug #6 one layer up: the seller sees
 * two identical rows in the editor and the buyer two identical steps in the
 * tracker, with no way to tell them apart.
 */
function refuseDuplicates(value: { stages: StageInput[] }, ctx: z.RefinementCtx): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  value.stages.forEach((stage, index) => {
    if (stage.id !== undefined) {
      if (ids.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'id'],
          message: `duplicate stage id ${stage.id}`,
        });
      }
      ids.add(stage.id);
    }
    const name = normalizeName(stage.name);
    if (names.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', index, 'name'],
        message: `duplicate stage name ${stage.name}`,
      });
    }
    names.add(name);
  });
}

export const UpdatePipelineSchema = z
  .object({
    // The version the editor loaded. The service conditions its write on it, so
    // two admins saving at once cannot silently clobber one another.
    version: z.number().int().nonnegative(),
    stages: z.array(StageInputSchema).min(1).max(MAX_STAGES),
  })
  .strict()
  .superRefine(refuseDuplicates);
export type UpdatePipeline = z.infer<typeof UpdatePipelineSchema>;

/** Crockford base32, so it satisfies UlidSchema. */
export const DEFAULT_STAGE_ID = '0'.repeat(26);

/**
 * What a shop that has never configured a pipeline has, and what an order
 * written before this feature existed normalises to on read. Absence is a
 * state, not an error -- the same treatment `getAnnouncement` gives a shop
 * that has never set an announcement.
 */
export const DEFAULT_PIPELINE: Pipeline = {
  version: 0,
  stages: [{ id: DEFAULT_STAGE_ID, name: 'Confirmed', cancellable: true, messaging: false }],
};
