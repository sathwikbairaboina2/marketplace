import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeDraftSchemaNode } from './draft-schema.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('add dietaryNeeds as text')],
  phase: 'drafting',
  targetEntity: 'Event',
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('draftSchemaNode', () => {
  it('builds a blueprint diff and applies contract defaults', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    const out = await makeDraftSchemaNode({ llm })(base);
    expect(out.draftPayload).toEqual({
      addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }],
    });
    expect(out.phase).toBe('validating');
    expect(out.draftAttempts).toBe(1);
  });

  it('feeds previous validation errors back to the model', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    await makeDraftSchemaNode({ llm })({
      ...base,
      draftAttempts: 1,
      validationErrors: ['dietaryNeeds already exists'],
    });
    const prompt = llm.calls[0].system;
    expect(prompt).toContain('dietaryNeeds already exists');
  });

  it('counts attempts cumulatively', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'x', type: 'string', required: false }] });

    const out = await makeDraftSchemaNode({ llm })({ ...base, draftAttempts: 2 });
    expect(out.draftAttempts).toBe(3);
  });
});
