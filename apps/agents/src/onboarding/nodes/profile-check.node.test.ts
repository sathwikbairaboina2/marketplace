import { makeProfileCheckNode } from './profile-check.node';
import { defaultOnboardingState } from '../state';

const llm = { structured: jest.fn(), text: jest.fn() };

beforeEach(() => jest.clearAllMocks());

describe('profileCheck', () => {
  it('asks one question while the profile is incomplete', async () => {
    llm.structured.mockResolvedValue({
      complete: false,
      profile: null,
      question: 'What is your business called?',
    });

    const node = makeProfileCheckNode({ llm });
    const result = await node(defaultOnboardingState);

    expect(result.phase).toBe('gathering');
    expect(result.messages?.[0].content).toBe('What is your business called?');
  });

  it('moves to generating with the parsed profile once complete', async () => {
    llm.structured.mockResolvedValue({
      complete: true,
      profile: { kind: 'ceramics studio', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
      question: '',
    });

    const node = makeProfileCheckNode({ llm });
    const result = await node(defaultOnboardingState);

    expect(result.phase).toBe('generating');
    expect(result.profile).toEqual({
      kind: 'ceramics studio',
      name: 'Kiln & Loom',
      tone: 'warm',
      audience: 'gifts',
    });
  });

  it('short-circuits without the LLM when a profile is already known', async () => {
    const node = makeProfileCheckNode({ llm });
    const result = await node({
      ...defaultOnboardingState,
      profile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
    });

    expect(result).toEqual({ phase: 'generating' });
    expect(llm.structured).not.toHaveBeenCalled();
  });

  it('keeps gathering with a fallback question when the model claims complete but the profile fails the contract', async () => {
    llm.structured.mockResolvedValue({
      complete: true,
      profile: { kind: '', name: '', tone: '', audience: '' },
      question: '',
    });

    const node = makeProfileCheckNode({ llm });
    const result = await node(defaultOnboardingState);

    expect(result.phase).toBe('gathering');
    expect(result.messages?.[0].content).toMatch(/business/i);
  });
});
