import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeAnalyzeIntentNode } from './analyze-intent.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('I want to track dietary needs on events')],
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

describe('analyzeIntentNode', () => {
  it('sets the target entity when the model identifies one', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });

    const out = await makeAnalyzeIntentNode({ llm })(base);
    expect(out.targetEntity).toBe('Event');
    expect(out.phase).toBe('drafting');
  });

  it('halts at gathering with a question when no entity is identified', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type should this apply to?' });

    const out = await makeAnalyzeIntentNode({ llm })(base);
    expect(out.targetEntity).toBeNull();
    expect(out.phase).toBe('gathering');
    expect(out.messages).toHaveLength(1);
  });

  it('keeps an entity already established earlier in the conversation', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'none', clarification: 'unclear' });

    const out = await makeAnalyzeIntentNode({ llm })({ ...base, targetEntity: 'Product' });
    expect(out.targetEntity).toBe('Product');
    expect(out.phase).toBe('drafting');
  });
});
