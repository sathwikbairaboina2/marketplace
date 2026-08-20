import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { OnboardingState, defaultOnboardingState } from '../state';
import { makeInferNeedsNode } from './infer-needs.node';

const requirements = {
  sellsWhat: 'bookable' as const,
  categories: ['classes', 'retreats'],
  fulfilment: 'in person at the studio',
  priceBand: 'mid',
  differentiator: 'small groups',
};

const state = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  ...defaultOnboardingState,
  profile: { kind: 'yoga studio', name: 'Nimbus', tone: 'calm', audience: 'locals' },
  requirements,
  ...over,
});

describe('inferNeeds node', () => {
  let llm: ScriptedLlmProvider;
  let node: ReturnType<typeof makeInferNeedsNode>;

  beforeEach(() => {
    llm = new ScriptedLlmProvider();
    node = makeInferNeedsNode({ llm, maxAttempts: 3 });
  });

  it('builds a plan from the requirements', async () => {
    llm.pushStructured({
      sellsWhat: 'bookable',
      categories: ['classes', 'retreats'],
      fields: [
        {
          entity: 'Event',
          field: { name: 'durationMinutes', type: 'number' },
          rationale: 'classes vary',
        },
      ],
    });

    const next = await node(state());

    expect(next.setupPlan?.sellsWhat).toBe('bookable');
    expect(next.setupPlan?.fields).toHaveLength(1);
    expect(next.setupPlan?.fields[0].field.required).toBe(false);
  });

  it('drops a reserved field name and keeps the rest of the plan', async () => {
    llm.pushStructured({
      sellsWhat: 'bookable',
      categories: ['classes'],
      fields: [
        { entity: 'Event', field: { name: 'capacity', type: 'number' }, rationale: 'reserved' },
        { entity: 'Event', field: { name: 'level', type: 'string' }, rationale: 'beginner or not' },
      ],
    });

    const next = await node(state());

    expect(next.setupPlan?.fields.map((f) => f.field.name)).toEqual(['level']);
  });

  it('drops a field whose type is not one the registry knows', async () => {
    llm.pushStructured({
      sellsWhat: 'bookable',
      categories: [],
      fields: [
        { entity: 'Event', field: { name: 'mood', type: 'vibes' }, rationale: 'nope' },
        { entity: 'Event', field: { name: 'level', type: 'string' }, rationale: 'keep' },
      ],
    });

    const next = await node(state());

    expect(next.setupPlan?.fields.map((f) => f.field.name)).toEqual(['level']);
  });

  it('falls back to the stated sellsWhat when the model contradicts it', async () => {
    llm.pushStructured({ sellsWhat: 'nonsense', categories: [], fields: [] });

    const next = await node(state());

    expect(next.setupPlan?.sellsWhat).toBe('bookable');
  });

  it('falls back to the stated categories when the model returns none', async () => {
    llm.pushStructured({ sellsWhat: 'bookable', categories: [], fields: [] });

    const next = await node(state());

    expect(next.setupPlan?.categories).toEqual(['classes', 'retreats']);
  });

  it('produces no plan when requirements were never completed', async () => {
    const next = await node(state({ requirements: null }));

    expect(next.setupPlan).toBeNull();
    expect(llm.calls).toHaveLength(0);
  });

  it('gives up after maxAttempts and leaves the plan null rather than failing the run', async () => {
    for (let i = 0; i < 3; i++) {
      llm.pushStructured({ sellsWhat: 'bookable', categories: [], fields: 'not-an-array' });
    }

    const next = await node(state());

    expect(next.setupPlan).toBeNull();
    expect(llm.calls).toHaveLength(3);
  });

  it('caps the plan at six fields even when the model returns more', async () => {
    llm.pushStructured({
      sellsWhat: 'bookable',
      categories: [],
      fields: Array.from({ length: 9 }, (_, i) => ({
        entity: 'Event',
        field: { name: `extra${i}`, type: 'string' },
        rationale: 'x',
      })),
    });

    const next = await node(state());

    expect(next.setupPlan?.fields).toHaveLength(6);
  });
});
