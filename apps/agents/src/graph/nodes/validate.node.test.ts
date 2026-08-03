import { makeValidateNode } from './validate.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [],
  phase: 'validating',
  targetEntity: 'Event',
  draftPayload: { addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }] },
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 1,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

const validate = makeValidateNode({ maxAttempts: 3 });

describe('validateNode', () => {
  it('accepts a clean add-fields diff and awaits confirmation', async () => {
    const out = await validate(base);
    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.validationErrors).toEqual([]);
    expect(out.messages).toHaveLength(1);
  });

  it('clears a stale dispatchedMessageId when approving a new draft', async () => {
    // A prior proposal on this same thread was already dispatched; approving a
    // second, distinct draft must not let that stale id survive and silently
    // short-circuit the next confirm.
    const out = await validate({ ...base, dispatchedMessageId: 'msg-from-a-previous-proposal' });
    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.dispatchedMessageId).toBeNull();
  });

  it('rejects a field that already exists in the registry', async () => {
    const out = await validate({
      ...base,
      registrySnapshot: {
        version: 1,
        fields: { dietaryNeeds: { type: 'string', required: false, default: null } },
      },
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors[0]).toContain('dietaryNeeds');
  });

  it('rejects a name that collides with a core field', async () => {
    const out = await validate({
      ...base,
      draftPayload: { addedFields: [{ name: 'capacity', type: 'number', required: false, default: null }] },
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors[0]).toContain('capacity');
  });

  it('rejects a diff that fails the contract schema', async () => {
    const out = await validate({
      ...base,
      draftPayload: { addedFields: [] } as never,
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors.length).toBeGreaterThan(0);
  });

  it('gives up at the attempt ceiling instead of looping', async () => {
    const out = await validate({
      ...base,
      draftAttempts: 3,
      registrySnapshot: {
        version: 1,
        fields: { dietaryNeeds: { type: 'string', required: false, default: null } },
      },
    });
    expect(out.phase).toBe('gathering');
    expect(out.draftPayload).toBeNull();
    expect(out.draftAttempts).toBe(0);
    expect(out.messages).toHaveLength(1);
  });
});
