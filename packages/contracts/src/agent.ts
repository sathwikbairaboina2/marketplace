import { z } from 'zod';
import { UlidSchema } from './common';
import { BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';
import { SetupPlanSchema, StorefrontConfigSchema } from './storefront';

export const AgentPhaseSchema = z.enum([
  'gathering',
  'drafting',
  'validating',
  'awaiting_confirmation',
  'done',
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** What the server emits on every halt. The client renders from this and nothing else. */
export const AgentStateSnapshotSchema = z.object({
  threadId: UlidSchema,
  phase: AgentPhaseSchema,
  targetEntity: DynamicEntityTypeSchema.nullable(),
  messages: z.array(ChatMessageSchema),
  draftPayload: BlueprintDiffSchema.nullable(),
  missingRequirements: z.array(z.string()),
  validationErrors: z.array(z.string()),
  dispatchedMessageId: z.string().nullable(),
});
export type AgentStateSnapshot = z.infer<typeof AgentStateSnapshotSchema>;

// .strict() on the four wire-event schemas below is what makes a
// client/server disagreement detectable: an unrecognized key (a typo like
// `contnet`, or a field a stale client still sends) is rejected instead of
// silently stripped. AgentStateSnapshotSchema deliberately stays non-strict --
// the server authors it, and a strict snapshot would turn any future
// additive field into a hard break for older clients.
export const ThreadResumeSchema = z.object({ threadId: UlidSchema }).strict();
export type ThreadResume = z.infer<typeof ThreadResumeSchema>;

export const SendMessageSchema = z
  .object({
    threadId: UlidSchema,
    content: z.string().min(1).max(4000),
  })
  .strict();
export type SendMessage = z.infer<typeof SendMessageSchema>;

export const ConfirmSchema = z.object({ threadId: UlidSchema }).strict();
export type Confirm = z.infer<typeof ConfirmSchema>;

export const RejectSchema = z
  .object({
    threadId: UlidSchema,
    notes: z.string().max(4000).optional(),
  })
  .strict();
export type Reject = z.infer<typeof RejectSchema>;

export const ThreadKindSchema = z.enum(['schema', 'onboarding']);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

/** thread.start payload. Optional on the wire: the gateway parses `body ?? {}`. */
export const ThreadStartSchema = z
  .object({ kind: ThreadKindSchema.default('schema') })
  .strict();
export type ThreadStart = z.infer<typeof ThreadStartSchema>;

export const OnboardingPhaseSchema = z.enum(['gathering', 'generating', 'drafted']);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

/**
 * Non-strict like AgentStateSnapshotSchema, and carries `kind` so a client can
 * discriminate the union (the schema snapshot predates kinds and has none).
 */
export const OnboardingSnapshotSchema = z.object({
  threadId: UlidSchema,
  kind: z.literal('onboarding'),
  phase: OnboardingPhaseSchema,
  messages: z.array(ChatMessageSchema),
  draft: StorefrontConfigSchema.nullable(),
  // Defaulted rather than required: a client parsing a snapshot from a server
  // that predates setup plans reads null instead of failing.
  setupPlan: SetupPlanSchema.nullable().default(null),
});
export type OnboardingSnapshot = z.infer<typeof OnboardingSnapshotSchema>;

export type AgentSnapshot = AgentStateSnapshot | OnboardingSnapshot;

export const AGENT_EVENTS = {
  threadStart: 'thread.start',
  threadResume: 'thread.resume',
  message: 'message',
  confirm: 'confirm',
  reject: 'reject',
  state: 'state',
  error: 'error',
} as const;

/** POST /copywriter/draft: the seller's one-shot description writer. */
export const CopywriterDraftRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(100),
    tone: z.string().trim().max(200).optional(),
    audience: z.string().trim().max(200).optional(),
  })
  .strict();
export type CopywriterDraftRequest = z.infer<typeof CopywriterDraftRequestSchema>;

export const CopywriterDraftResponseSchema = z.object({
  /** Bounded by the product contract: what cannot be saved must not be drafted. */
  description: z.string().min(1).max(5000),
});
export type CopywriterDraftResponse = z.infer<typeof CopywriterDraftResponseSchema>;

/** POST /support/ask: a buyer's question answered from their own orders. */
export const SupportAskRequestSchema = z
  .object({ question: z.string().trim().min(1).max(1000) })
  .strict();
export type SupportAskRequest = z.infer<typeof SupportAskRequestSchema>;

export const SupportAskResponseSchema = z.object({
  answer: z.string().min(1).max(5000),
});
export type SupportAskResponse = z.infer<typeof SupportAskResponseSchema>;
