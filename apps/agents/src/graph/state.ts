import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import {
  AgentPhase,
  AgentStateSnapshot,
  BlueprintDiff,
  ChatMessage,
  DynamicEntityType,
  EntitySchemaRecord,
} from '@marketplace/contracts';

export type PendingAction = 'message' | 'confirm' | 'reject';

/**
 * The non-message fields' defaults, named once. `AgentAnnotation`'s channels
 * and `defaultAgentState` below both read from this object rather than each
 * hand-writing the initial values, so the two can't drift apart.
 *
 * (`AnnotationRoot.spec` holds already-constructed channel instances with no
 * public API to ask one "what is your default value" at runtime, which is why
 * this is a plain constant rather than something derived from `AgentAnnotation`
 * after the fact.)
 *
 * Exported (only) so a test can assert its keys stay in sync with
 * `AgentAnnotation`'s channels -- see the "channel keys" test in
 * `state.test.ts`, which enumerates `AgentAnnotation.spec` (a plain object of
 * channel name -> channel/factory, and public) to catch a channel added to
 * the annotation without a matching entry here.
 */
export const AGENT_FIELD_DEFAULTS = {
  phase: 'gathering' as AgentPhase,
  targetEntity: null as DynamicEntityType | null,
  draftPayload: null as BlueprintDiff | null,
  missingRequirements: [] as string[],
  registrySnapshot: null as EntitySchemaRecord | null,
  validationErrors: [] as string[],
  draftAttempts: 0,
  dispatchedMessageId: null as string | null,
  pendingAction: 'message' as PendingAction,
};

const replace = <T>(defaultValue: () => T) =>
  Annotation<T>({ reducer: (_current: T, next: T) => next, default: defaultValue });

export const AgentAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  phase: replace<AgentPhase>(() => AGENT_FIELD_DEFAULTS.phase),
  targetEntity: replace<DynamicEntityType | null>(() => AGENT_FIELD_DEFAULTS.targetEntity),
  draftPayload: replace<BlueprintDiff | null>(() => AGENT_FIELD_DEFAULTS.draftPayload),
  missingRequirements: replace<string[]>(() => AGENT_FIELD_DEFAULTS.missingRequirements),
  registrySnapshot: replace<EntitySchemaRecord | null>(() => AGENT_FIELD_DEFAULTS.registrySnapshot),
  validationErrors: replace<string[]>(() => AGENT_FIELD_DEFAULTS.validationErrors),
  draftAttempts: replace<number>(() => AGENT_FIELD_DEFAULTS.draftAttempts),
  dispatchedMessageId: replace<string | null>(() => AGENT_FIELD_DEFAULTS.dispatchedMessageId),
  pendingAction: replace<PendingAction>(() => AGENT_FIELD_DEFAULTS.pendingAction),
});

export type AgentState = typeof AgentAnnotation.State;

/**
 * The state of a thread `getState()` has never seen a checkpoint for:
 * LangGraph's `getState()` returns `{ values: {} }` in that case (verified
 * against the installed @langchain/langgraph@1.4.8's `_prepareStateSnapshot`),
 * so a never-run thread needs an explicit initial state rather than one
 * assembled implicitly from a prior run.
 */
export const defaultAgentState: AgentState = {
  messages: [],
  ...AGENT_FIELD_DEFAULTS,
};

function toChatMessage(message: BaseMessage): ChatMessage {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return { role: message.getType() === 'human' ? 'user' : 'assistant', content };
}

/** What the LLM nodes send as conversation history. */
export function toChatMessages(messages: BaseMessage[] | undefined): ChatMessage[] {
  return (messages ?? []).map(toChatMessage);
}

/**
 * The client view. `registrySnapshot`, `draftAttempts` and `pendingAction` are
 * deliberately absent: they are how the graph works, not what the user decided.
 */
export function toSnapshot(threadId: string, state: AgentState): AgentStateSnapshot {
  return {
    threadId,
    phase: state.phase,
    targetEntity: state.targetEntity,
    messages: toChatMessages(state.messages),
    draftPayload: state.draftPayload,
    missingRequirements: state.missingRequirements,
    validationErrors: state.validationErrors,
    dispatchedMessageId: state.dispatchedMessageId,
  };
}
