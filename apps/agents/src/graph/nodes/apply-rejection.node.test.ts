import { makeApplyRejectionNode } from './apply-rejection.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [],
  phase: 'awaiting_confirmation',
  targetEntity: 'Event',
  draftPayload: { addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }] },
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 1,
  dispatchedMessageId: null,
  pendingAction: 'reject',
};

describe('applyRejectionNode', () => {
  it('ends the thread on a bare rejection', async () => {
    const out = await makeApplyRejectionNode()(base);
    expect(out.phase).toBe('done');
    expect(out.draftPayload).toBeNull();
  });

  it('returns to gathering when the user supplied revision notes', async () => {
    const out = await makeApplyRejectionNode()({
      ...base,
      messages: [{ getType: () => 'human', content: 'make it a list instead' } as never],
    });
    expect(out.phase).toBe('gathering');
    expect(out.draftPayload).toBeNull();
    expect(out.draftAttempts).toBe(0);
  });
});
