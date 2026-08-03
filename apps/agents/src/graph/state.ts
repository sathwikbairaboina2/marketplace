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

const replace = <T>(defaultValue: () => T) =>
  Annotation<T>({ reducer: (_current: T, next: T) => next, default: defaultValue });

export const AgentAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  phase: replace<AgentPhase>(() => 'gathering'),
  targetEntity: replace<DynamicEntityType | null>(() => null),
  draftPayload: replace<BlueprintDiff | null>(() => null),
  missingRequirements: replace<string[]>(() => []),
  registrySnapshot: replace<EntitySchemaRecord | null>(() => null),
  validationErrors: replace<string[]>(() => []),
  draftAttempts: replace<number>(() => 0),
  dispatchedMessageId: replace<string | null>(() => null),
  pendingAction: replace<PendingAction>(() => 'message'),
});

export type AgentState = typeof AgentAnnotation.State;

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
