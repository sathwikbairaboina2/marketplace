import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeRequirementCheckNode } from './requirement-check.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('track dietary needs on events')],
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

describe('requirementCheckNode', () => {
  it('proceeds to drafting when the request is specific enough', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ satisfied: true, missing: [], question: '' });

    const out = await makeRequirementCheckNode({ llm })(base);
    expect(out.phase).toBe('drafting');
    expect(out.missingRequirements).toEqual([]);
  });

  it('halts at gathering and asks for what is missing', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({
      satisfied: false,
      missing: ['data type of dietaryNeeds'],
      question: 'Should dietary needs be free text or a list?',
    });

    const out = await makeRequirementCheckNode({ llm })(base);
    expect(out.phase).toBe('gathering');
    expect(out.missingRequirements).toEqual(['data type of dietaryNeeds']);
    expect(out.messages).toHaveLength(1);
  });

  it('shows the model the fields that already exist', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ satisfied: true, missing: [], question: '' });

    await makeRequirementCheckNode({ llm })({
      ...base,
      registrySnapshot: { version: 1, fields: { seats: { type: 'number', required: true, default: null } } },
    });
    expect(llm.calls[0].system).toContain('seats');
  });
});
