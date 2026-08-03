import { z } from 'zod';
import { UlidSchema } from './common';
import { BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';

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

export const ThreadResumeSchema = z.object({ threadId: UlidSchema });
export type ThreadResume = z.infer<typeof ThreadResumeSchema>;

export const SendMessageSchema = z.object({
  threadId: UlidSchema,
  content: z.string().min(1).max(4000),
});
export type SendMessage = z.infer<typeof SendMessageSchema>;

export const ConfirmSchema = z.object({ threadId: UlidSchema });
export type Confirm = z.infer<typeof ConfirmSchema>;

export const RejectSchema = z.object({
  threadId: UlidSchema,
  notes: z.string().max(4000).optional(),
});
export type Reject = z.infer<typeof RejectSchema>;

export const AGENT_EVENTS = {
  threadStart: 'thread.start',
  threadResume: 'thread.resume',
  message: 'message',
  confirm: 'confirm',
  reject: 'reject',
  state: 'state',
  error: 'error',
} as const;
