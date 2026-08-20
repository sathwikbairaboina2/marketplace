import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { OnboardingState, defaultOnboardingState } from '../state';
import { ASK_MAX, makeInterviewNode } from './interview.node';

const profile = { kind: 'pottery', name: 'Kiln & Loom', tone: 'warm', audience: 'gift buyers' };

const requirements = {
  sellsWhat: 'goods',
  categories: ['mugs', 'jugs'],
  fulfilment: 'ship nationwide',
  priceBand: 'mid',
  differentiator: 'hand-thrown, small batches',
};

const complete = { satisfied: true, profile, requirements, question: '' };

const state = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  ...defaultOnboardingState,
  messages: [new HumanMessage('I run a pottery studio')],
  ...over,
});

describe('interview node', () => {
  let llm: ScriptedLlmProvider;
  let node: ReturnType<typeof makeInterviewNode>;

  beforeEach(() => {
    llm = new ScriptedLlmProvider();
    node = makeInterviewNode({ llm, askMax: ASK_MAX });
  });

  it('asks one question and stays gathering when the model is not satisfied', async () => {
    llm.pushStructured({
      satisfied: false,
      profile: null,
      requirements: null,
      question: 'What do you sell?',
    });

    const next = await node(state());

    expect(next.phase).toBe('gathering');
    expect(next.questionCount).toBe(1);
    expect(next.profile).toBeUndefined();
  });

  it('ignores satisfied:true when the profile does not parse', async () => {
    llm.pushStructured({
      satisfied: true,
      profile: { kind: '', name: '', tone: 'warm', audience: 'anyone' },
      requirements: null,
      question: 'What is the business called?',
    });

    const next = await node(state());

    expect(next.phase).toBe('gathering');
    expect(next.questionCount).toBe(1);
  });

  it('advances with profile and requirements once both parse', async () => {
    llm.pushStructured(complete);

    const next = await node(state());

    expect(next.phase).toBe('generating');
    expect(next.profile?.name).toBe('Kiln & Loom');
    expect(next.requirements?.sellsWhat).toBe('goods');
  });

  it('keeps a complete profile when requirements are still partial', async () => {
    llm.pushStructured({ ...complete, requirements: null });

    const next = await node(state());

    expect(next.phase).toBe('generating');
    expect(next.requirements).toBeNull();
  });

  it('forces progress at the cap even while the model wants to keep asking', async () => {
    llm.pushStructured({
      satisfied: false,
      profile,
      requirements: null,
      question: 'And your postcode?',
    });

    const next = await node(state({ questionCount: ASK_MAX - 1 }));

    expect(next.phase).toBe('generating');
    expect(next.requirements).toBeNull();
  });

  it('stays gathering at the cap when there is no usable profile to proceed with', async () => {
    llm.pushStructured({ satisfied: false, profile: null, requirements: null, question: 'Name?' });

    const next = await node(state({ questionCount: ASK_MAX - 1 }));

    expect(next.phase).toBe('gathering');
  });

  it('falls back to a question of its own when the model returns none', async () => {
    llm.pushStructured({ satisfied: false, profile: null, requirements: null, question: '   ' });

    const next = await node(state());

    expect(next.phase).toBe('gathering');
    expect(next.messages).toHaveLength(1);
  });

  it('does not re-interrogate a thread that already has a profile', async () => {
    const next = await node(state({ profile }));

    expect(next.phase).toBe('generating');
    expect(llm.calls).toHaveLength(0);
  });

  it('drops requirements the contracts reject rather than storing them half-parsed', async () => {
    llm.pushStructured({
      ...complete,
      // A missing answer, not a mis-worded one: coercion widens the wording it
      // accepts, it does not fill in a field the owner never answered.
      requirements: { ...requirements, priceBand: '' },
    });

    const next = await node(state());

    expect(next.phase).toBe('generating');
    expect(next.requirements).toBeNull();
  });
});

describe('interview node requirement coercion', () => {
  let llm: ScriptedLlmProvider;
  let node: ReturnType<typeof makeInterviewNode>;

  beforeEach(() => {
    llm = new ScriptedLlmProvider();
    node = makeInterviewNode({ llm, askMax: ASK_MAX });
  });

  const withRequirements = (over: Record<string, unknown>) => ({
    ...complete,
    requirements: { ...requirements, ...over },
  });

  it('reads "physical goods" as goods', async () => {
    llm.pushStructured(withRequirements({ sellsWhat: 'physical goods' }));

    const next = await node(state());

    expect(next.requirements?.sellsWhat).toBe('goods');
  });

  it('reads "bookable classes" as bookable', async () => {
    llm.pushStructured(withRequirements({ sellsWhat: 'bookable classes' }));

    const next = await node(state());

    expect(next.requirements?.sellsWhat).toBe('bookable');
  });

  it('reads a mix of both as both', async () => {
    llm.pushStructured(withRequirements({ sellsWhat: 'products and classes' }));

    const next = await node(state());

    expect(next.requirements?.sellsWhat).toBe('both');
  });

  // The regression that matters: a shop selling books takes no bookings.
  it('does not read a bookshop selling books as bookable', async () => {
    llm.pushStructured(
      withRequirements({ sellsWhat: 'books and stationery', categories: ['paperbacks'] }),
    );

    const next = await node(state());

    expect(next.requirements?.sellsWhat).toBe('goods');
  });

  it('trims an over-long category list to the cap instead of losing the whole answer', async () => {
    llm.pushStructured(
      withRequirements({ categories: Array.from({ length: 11 }, (_, i) => `c${i}`) }),
    );

    const next = await node(state());

    expect(next.requirements?.categories).toHaveLength(8);
  });

  it('truncates an over-long differentiator rather than dropping requirements', async () => {
    llm.pushStructured(withRequirements({ differentiator: 'x'.repeat(900) }));

    const next = await node(state());

    expect(next.requirements?.differentiator).toHaveLength(400);
  });

  // Guessing wrong costs one radio click in a tab the owner confirms; guessing
  // nothing costs the whole plan.
  it('falls back to goods rather than losing the plan to an unreadable answer', async () => {
    llm.pushStructured(withRequirements({ sellsWhat: 'vibes' }));

    const next = await node(state());

    expect(next.requirements?.sellsWhat).toBe('goods');
  });

  it('still rejects requirements with an empty fulfilment', async () => {
    llm.pushStructured(withRequirements({ fulfilment: '   ' }));

    const next = await node(state());

    expect(next.requirements).toBeNull();
  });
});
