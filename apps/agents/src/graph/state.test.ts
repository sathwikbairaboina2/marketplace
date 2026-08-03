import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { AGENT_FIELD_DEFAULTS, AgentAnnotation, toSnapshot, AgentState } from './state';

const threadId = '01J8Z5X9T7QK4W2M6N3P8R5V1C';

const base: AgentState = {
  messages: [],
  phase: 'gathering',
  targetEntity: null,
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: null,
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('toSnapshot', () => {
  it('maps langchain messages to contract chat messages', () => {
    const snapshot = toSnapshot(threadId, {
      ...base,
      messages: [new HumanMessage('add a field'), new AIMessage('which entity?')],
    });
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'add a field' },
      { role: 'assistant', content: 'which entity?' },
    ]);
  });

  it('omits internal-only state from the client view', () => {
    const snapshot = toSnapshot(threadId, { ...base, draftAttempts: 2, registrySnapshot: { version: 3, fields: {} } });
    expect(snapshot).not.toHaveProperty('draftAttempts');
    expect(snapshot).not.toHaveProperty('registrySnapshot');
    expect(snapshot).not.toHaveProperty('pendingAction');
  });

  it('produces a snapshot that satisfies the published contract', () => {
    expect(() => AgentStateSnapshotSchema.parse(toSnapshot(threadId, base))).not.toThrow();
  });
});

describe('AGENT_FIELD_DEFAULTS', () => {
  it('has exactly one entry per AgentAnnotation channel other than messages', () => {
    // `AgentAnnotation.spec` is the plain StateDefinition object passed to
    // `Annotation.Root` (messages plus every `replace<T>(...)` channel below
    // it), so its keys are the full, current list of channels -- this is
    // what would catch someone adding a channel to AgentAnnotation and hand
    // -satisfying `defaultAgentState`'s literal type without also adding it
    // here, which would compile silently.
    const channelKeys = Object.keys(AgentAnnotation.spec).filter((key) => key !== 'messages');
    expect(Object.keys(AGENT_FIELD_DEFAULTS).sort()).toEqual([...channelKeys].sort());
  });
});
