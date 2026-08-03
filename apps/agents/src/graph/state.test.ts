import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { toSnapshot, AgentState } from './state';

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
