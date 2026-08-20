# Requirements-Led Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The onboarding wizard interrogates the owner until it genuinely understands the business, then proposes a concrete setup — what the shop sells, which categories, which extra entity fields — that the owner confirms with one click.

**Architecture:** One new adaptive `interview` node replaces `profileCheck` in the existing onboarding graph, bounded by a deterministic floor and a hard question cap. A new `inferNeeds` node turns the gathered requirements into a `SetupPlan` carried on the snapshot. Applying the plan is a single agents-service endpoint that writes the storefront half through `EngineClient` and queues the field half through the existing `DispatchService` FIFO flow-proposal path.

**Tech Stack:** TypeScript, NestJS, LangGraph, zod (`@marketplace/contracts`), Next.js App Router, antd, jest, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-onboarding-requirements-design.md`

## Global Constraints

- **No floats for money.** Minor units, integers, bounds in `packages/contracts/src/common.ts`. Nothing in this plan touches money; do not introduce any.
- **Every error is an RFC 9457 problem document.** `ProblemType` in `apps/engine/src/common/problem.ts` (and `apps/agents/src/common/problem.ts`) is a closed union. This plan adds **no** new problem type — it reuses `invalid-request`, `dispatch-failed`, `engine-unavailable`, `unauthorized`, `internal-error`.
- **Ownership failures answer 404, never 403.**
- **Admin-only routes carry both** a `@Roles('admin')` decorator and a service-side check. The decorator makes the restriction visible in the OpenAPI document; the service check is what the unit tests pin.
- **Nothing may be inserted into the order transaction ahead of the line-item updates.** Not touched here.
- **Race tests assert on outcomes, not error classes.**
- **Never use `window.confirm`, `alert` or `prompt` in web code.** antd `Popconfirm` only.
- **Type checking is `build`.** There is no `typecheck` script. `nest build` and `next build` are what surface type errors; `next build` also lints.
- **Repo-wide tests run `npx turbo run test --concurrency=1`.** Parallel runs produce false failures. Re-run any red suite alone before believing it.
- **Verify UI by rendering it and looking.** Passing tests prove behaviour, not appearance.
- **Caps are contract-enforced:** 8 categories, 6 field proposals, `ASK_MAX = 5` interview questions.

---

### Task 1: Contracts for requirements and the setup plan

**Files:**
- Modify: `packages/contracts/src/storefront.ts`
- Modify: `packages/contracts/src/agent.ts:79-86`
- Modify: `packages/contracts/src/index.ts` (export the new symbols)
- Test: `packages/contracts/src/storefront.test.ts`, `packages/contracts/src/agent.test.ts`

**Interfaces:**
- Consumes: `AddedFieldSchema`, `refuseReservedFieldNames` from `./flow`; `DynamicEntityTypeSchema` from `./registry`.
- Produces: `SellsWhatSchema`/`SellsWhat`, `BusinessRequirementsSchema`/`BusinessRequirements`, `FieldProposalSchema`/`FieldProposal`, `SetupPlanSchema`/`SetupPlan`, `ApplySetupPlanRequestSchema`/`ApplySetupPlanRequest`, `ApplySetupPlanResponseSchema`/`ApplySetupPlanResponse`. `StorefrontConfigSchema` gains optional `sellsWhat` and `categories`. `OnboardingSnapshotSchema` gains `setupPlan`.

- [ ] **Step 1: Write the failing contract tests**

Append to `packages/contracts/src/storefront.test.ts`:

```ts
import {
  ApplySetupPlanRequestSchema,
  BusinessRequirementsSchema,
  FieldProposalSchema,
  SetupPlanSchema,
  StorefrontConfigSchema,
} from './storefront';

const plan = {
  sellsWhat: 'bookable' as const,
  categories: ['classes', 'retreats'],
  fields: [
    {
      entity: 'Event' as const,
      field: { name: 'durationMinutes', type: 'number' as const, required: false, default: null },
      rationale: 'classes vary in length',
    },
  ],
};

describe('BusinessRequirementsSchema', () => {
  it('rejects more than eight categories', () => {
    const result = BusinessRequirementsSchema.safeParse({
      sellsWhat: 'goods',
      categories: Array.from({ length: 9 }, (_, i) => `c${i}`),
      fulfilment: 'ship',
      priceBand: 'mid',
      differentiator: 'handmade',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown sellsWhat', () => {
    const result = BusinessRequirementsSchema.safeParse({
      sellsWhat: 'services',
      categories: [],
      fulfilment: 'ship',
      priceBand: 'mid',
      differentiator: 'handmade',
    });
    expect(result.success).toBe(false);
  });
});

describe('FieldProposalSchema', () => {
  it('rejects a reserved core field name for the entity', () => {
    const result = FieldProposalSchema.safeParse({
      entity: 'Product',
      field: { name: 'priceMinor', type: 'number', required: false, default: null },
      rationale: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('accepts the same name on an entity that does not reserve it', () => {
    const result = FieldProposalSchema.safeParse({
      entity: 'Product',
      field: { name: 'capacity', type: 'number', required: false, default: null },
      rationale: 'containers have a capacity',
    });
    expect(result.success).toBe(true);
  });
});

describe('SetupPlanSchema', () => {
  it('accepts a plan within the caps', () => {
    expect(SetupPlanSchema.parse(plan).fields).toHaveLength(1);
  });

  it('rejects more than six field proposals', () => {
    const fields = Array.from({ length: 7 }, (_, i) => ({
      entity: 'Product' as const,
      field: { name: `extra${i}`, type: 'string' as const, required: false, default: null },
      rationale: 'x',
    }));
    expect(SetupPlanSchema.safeParse({ ...plan, fields }).success).toBe(false);
  });
});

describe('StorefrontConfigSchema with the new keys', () => {
  const base = {
    presetId: 'artisan',
    overrides: {},
    about: { title: 'A', sections: [{ heading: 'H', body: 'B' }] },
    banners: [],
    businessProfile: { kind: 'pottery', name: 'Kiln', tone: 'warm', audience: 'gift buyers' },
  };

  it('parses a draft written before the keys existed', () => {
    expect(StorefrontConfigSchema.safeParse(base).success).toBe(true);
  });

  it('parses a draft carrying them', () => {
    const parsed = StorefrontConfigSchema.parse({
      ...base,
      sellsWhat: 'goods',
      categories: ['mugs'],
    });
    expect(parsed.categories).toEqual(['mugs']);
  });
});

describe('ApplySetupPlanRequestSchema', () => {
  it('re-refuses a reserved field name the plan never proposed', () => {
    const result = ApplySetupPlanRequestSchema.safeParse({
      sellsWhat: 'goods',
      categories: [],
      fields: [
        { entity: 'Product', field: { name: 'priceMinor', type: 'number', required: false, default: null } },
      ],
    });
    expect(result.success).toBe(false);
  });
});
```

Append to `packages/contracts/src/agent.test.ts`, inside the existing `describe('OnboardingSnapshotSchema')`:

```ts
it('parses a snapshot from a server that predates setup plans', () => {
  const parsed = OnboardingSnapshotSchema.parse({
    threadId: ulid,
    kind: 'onboarding',
    phase: 'gathering',
    messages: [],
    draft: null,
  });
  expect(parsed.setupPlan).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/contracts test`
Expected: FAIL — `BusinessRequirementsSchema is not exported`, and the snapshot test fails because `setupPlan` is undefined.

- [ ] **Step 3: Add the schemas**

In `packages/contracts/src/storefront.ts`, add near `BusinessProfileSchema` (leave `BusinessProfileSchema` itself untouched — it is embedded in `StorefrontConfigSchema`, which is `.strict()` and has stored drafts):

```ts
import { AddedFieldSchema, refuseReservedFieldNames } from './flow';
import { DynamicEntityTypeSchema } from './registry';

export const SellsWhatSchema = z.enum(['goods', 'bookable', 'both']);
export type SellsWhat = z.infer<typeof SellsWhatSchema>;

const CategorySchema = z.string().trim().min(1).max(60);

/**
 * The operational half of what the wizard learns. Kept beside BusinessProfile
 * rather than inside it: the profile is embedded in every stored
 * StorefrontConfig, and widening a strict schema stops old drafts parsing.
 */
export const BusinessRequirementsSchema = z
  .object({
    sellsWhat: SellsWhatSchema,
    categories: z.array(CategorySchema).max(8),
    fulfilment: z.string().trim().min(1).max(200),
    priceBand: z.string().trim().min(1).max(200),
    differentiator: z.string().trim().min(1).max(400),
  })
  .strict();
export type BusinessRequirements = z.infer<typeof BusinessRequirementsSchema>;

/**
 * Reusing AddedFieldSchema is load-bearing: add-only (BlueprintDiff is strict,
 * so `removedFields` is an unrecognized key) and the reserved-name refusal
 * both arrive with it rather than being reimplemented here.
 */
export const FieldProposalSchema = z
  .object({
    entity: DynamicEntityTypeSchema,
    field: AddedFieldSchema,
    rationale: z.string().trim().max(200),
  })
  .strict()
  .superRefine((val, ctx) =>
    refuseReservedFieldNames(
      { targetEntity: val.entity, blueprintDiff: { addedFields: [val.field] } },
      ctx,
    ),
  );
export type FieldProposal = z.infer<typeof FieldProposalSchema>;

export const SetupPlanSchema = z
  .object({
    sellsWhat: SellsWhatSchema,
    categories: z.array(CategorySchema).max(8),
    fields: z.array(FieldProposalSchema).max(6),
  })
  .strict();
export type SetupPlan = z.infer<typeof SetupPlanSchema>;

/** The checkbox subset the owner actually confirmed. Never trusted: re-validated. */
export const ApplySetupPlanRequestSchema = z
  .object({
    sellsWhat: SellsWhatSchema,
    categories: z.array(CategorySchema).max(8),
    fields: z
      .array(
        z
          .object({ entity: DynamicEntityTypeSchema, field: AddedFieldSchema })
          .strict()
          .superRefine((val, ctx) =>
            refuseReservedFieldNames(
              { targetEntity: val.entity, blueprintDiff: { addedFields: [val.field] } },
              ctx,
            ),
          ),
      )
      .max(6),
  })
  .strict();
export type ApplySetupPlanRequest = z.infer<typeof ApplySetupPlanRequestSchema>;

export const ApplySetupPlanResponseSchema = z.object({
  applied: z.object({ sellsWhat: SellsWhatSchema, categories: z.array(CategorySchema) }),
  queued: z.array(
    z.object({ entity: DynamicEntityTypeSchema, fieldName: z.string(), messageId: z.string() }),
  ),
  failed: z.array(
    z.object({ entity: DynamicEntityTypeSchema, fieldName: z.string(), reason: z.string() }),
  ),
});
export type ApplySetupPlanResponse = z.infer<typeof ApplySetupPlanResponseSchema>;
```

In the same file, add two optional keys inside `StorefrontConfigSchema`'s object, before the closing `})`:

```ts
    // Optional so drafts written before this existed still parse against a
    // strict schema. Written by the setup-plan apply, read by the product
    // form's category suggestions and by storefront navigation.
    sellsWhat: SellsWhatSchema.optional(),
    categories: z.array(CategorySchema).max(8).optional(),
```

In `packages/contracts/src/agent.ts`, import `SetupPlanSchema` alongside the existing `StorefrontConfigSchema` import and add one key to `OnboardingSnapshotSchema`:

```ts
  setupPlan: SetupPlanSchema.nullable().default(null),
```

`.default(null)` is what makes the older-server test pass without making the key required.

Export everything new from `packages/contracts/src/index.ts` following the existing re-export style in that file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/contracts test`
Expected: PASS.

- [ ] **Step 5: Build the contracts package**

Run: `pnpm --filter @marketplace/contracts build`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): business requirements, setup plan and apply payloads"
```

---

### Task 2: Onboarding graph state carries requirements, plan and question count

**Files:**
- Modify: `apps/agents/src/onboarding/state.ts`
- Test: `apps/agents/src/onboarding/state.test.ts`

**Interfaces:**
- Consumes: `BusinessRequirements`, `SetupPlan` from Task 1.
- Produces: `OnboardingState` gains `requirements: BusinessRequirements | null`, `setupPlan: SetupPlan | null`, `questionCount: number`. `toOnboardingSnapshot` emits `setupPlan`.

- [ ] **Step 1: Write the failing test**

Append to `apps/agents/src/onboarding/state.test.ts`:

```ts
import { defaultOnboardingState, toOnboardingSnapshot } from './state';

describe('onboarding state additions', () => {
  it('defaults the new slices', () => {
    expect(defaultOnboardingState.requirements).toBeNull();
    expect(defaultOnboardingState.setupPlan).toBeNull();
    expect(defaultOnboardingState.questionCount).toBe(0);
  });

  it('puts the setup plan on the snapshot and keeps requirements internal', () => {
    const plan = { sellsWhat: 'goods' as const, categories: ['mugs'], fields: [] };
    const snap = toOnboardingSnapshot('01J8Z5X9T7QK4W2M6N3P8R5V1C', {
      ...defaultOnboardingState,
      setupPlan: plan,
      requirements: {
        sellsWhat: 'goods',
        categories: ['mugs'],
        fulfilment: 'ship',
        priceBand: 'mid',
        differentiator: 'handmade',
      },
    });
    expect(snap.setupPlan).toEqual(plan);
    expect(snap).not.toHaveProperty('requirements');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/agents test -- state.test`
Expected: FAIL — `requirements` does not exist on `defaultOnboardingState`.

- [ ] **Step 3: Add the slices**

In `apps/agents/src/onboarding/state.ts`, extend `ONBOARDING_FIELD_DEFAULTS` (the channels and defaults must keep reading from this one object — the channel-keys test pins the pairing):

```ts
  requirements: null as BusinessRequirements | null,
  setupPlan: null as SetupPlan | null,
  questionCount: 0,
```

Add the matching channels to `OnboardingAnnotation`:

```ts
  requirements: replace<BusinessRequirements | null>(() => ONBOARDING_FIELD_DEFAULTS.requirements),
  setupPlan: replace<SetupPlan | null>(() => ONBOARDING_FIELD_DEFAULTS.setupPlan),
  questionCount: replace<number>(() => ONBOARDING_FIELD_DEFAULTS.questionCount),
```

Add `setupPlan` to the returned snapshot in `toOnboardingSnapshot`, leaving `requirements` out — it is a working slice, like `profile` and `overrides`:

```ts
    setupPlan: state.setupPlan,
```

Import `BusinessRequirements` and `SetupPlan` from `@marketplace/contracts`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/agents test -- state.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/onboarding/state.ts apps/agents/src/onboarding/state.test.ts
git commit -m "feat(agents): onboarding state carries requirements, setup plan and question count"
```

---

### Task 3: The `interview` node

**Files:**
- Create: `apps/agents/src/onboarding/nodes/interview.node.ts`
- Create: `apps/agents/src/onboarding/nodes/interview.node.test.ts`
- Delete: `apps/agents/src/onboarding/nodes/profile-check.node.ts`, `apps/agents/src/onboarding/nodes/profile-check.node.test.ts`
- Modify: `apps/agents/src/onboarding/prompts.ts`

**Interfaces:**
- Consumes: `LlmProvider.structured`, `toChatMessages` from `../../graph/state`, `BusinessProfileSchema` and `BusinessRequirementsSchema` from Task 1, `OnboardingState` from Task 2.
- Produces: `makeInterviewNode(deps: { llm: LlmProvider; askMax: number })` returning `(state: OnboardingState) => Promise<Partial<OnboardingState>>`. Exports `ASK_MAX = 5`.

- [ ] **Step 1: Write the failing tests**

Create `apps/agents/src/onboarding/nodes/interview.node.test.ts`:

```ts
import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { defaultOnboardingState } from '../state';
import { ASK_MAX, makeInterviewNode } from './interview.node';

const complete = {
  satisfied: true,
  profile: { kind: 'pottery', name: 'Kiln & Loom', tone: 'warm', audience: 'gift buyers' },
  requirements: {
    sellsWhat: 'goods',
    categories: ['mugs', 'jugs'],
    fulfilment: 'ship nationwide',
    priceBand: 'mid',
    differentiator: 'hand-thrown, small batches',
  },
  question: '',
};

const state = (over = {}) => ({
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
    llm.pushStructured({ satisfied: false, profile: null, requirements: null, question: 'What do you sell?' });

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
    llm.pushStructured({ ...complete, satisfied: true, requirements: null, question: '' });

    const next = await node(state());

    expect(next.phase).toBe('generating');
    expect(next.requirements).toBeNull();
  });

  it('forces progress at the cap even while the model wants to keep asking', async () => {
    llm.pushStructured({
      satisfied: false,
      profile: complete.profile,
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

  it('does not re-interrogate a thread that already has a profile', async () => {
    const next = await node(state({ profile: complete.profile }));

    expect(next.phase).toBe('generating');
    expect(llm.calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/agents test -- interview.node`
Expected: FAIL — cannot resolve `./interview.node`.

- [ ] **Step 3: Write the prompts**

In `apps/agents/src/onboarding/prompts.ts`, replace `PROFILE_SYSTEM` with:

```ts
export const INTERVIEW_SYSTEM = `You are onboarding the owner of a new online store, and you
will use what you learn to set their shop up — not just to write copy. Decide whether the
conversation so far tells you enough about BOTH:
(a) who they are: what kind of business, the name, the tone they want, who the customers are;
(b) how the shop must work: whether they sell physical goods, bookable classes or events, or
    both; what the main categories of what they offer are; how it reaches the customer; roughly
    what price band; and what makes them different from a competitor.
If anything important is missing, set satisfied to false and ask ONE short friendly question
for the most important missing piece. Ask about (b) as readily as (a) — a shop that runs
classes and a shop that ships mugs need different setups.
Fill "profile" as soon as you know (a), even while still asking about (b). Fill "requirements"
only when you know ALL of (b); leave it null otherwise. Never invent values the owner has not
given or clearly implied.`;
```

Leave `THEME_SYSTEM` and `CONTENT_SYSTEM` unchanged.

- [ ] **Step 4: Write the node**

Create `apps/agents/src/onboarding/nodes/interview.node.ts`:

```ts
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { BusinessProfileSchema, BusinessRequirementsSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { INTERVIEW_SYSTEM } from '../prompts';

/**
 * The ceiling on an adaptive interview. The model decides when it knows
 * enough; this decides when it has had long enough to decide.
 */
export const ASK_MAX = 5;

/**
 * Loose on purpose, like ThemeResultSchema: the two nested objects are
 * validated against the real contracts below, where a near-miss costs the
 * slice rather than failing the structured call outright.
 */
const InterviewResultSchema = z.object({
  satisfied: z.boolean(),
  profile: z
    .object({ kind: z.string(), name: z.string(), tone: z.string(), audience: z.string() })
    .nullable(),
  requirements: z
    .object({
      sellsWhat: z.string(),
      categories: z.array(z.string()),
      fulfilment: z.string(),
      priceBand: z.string(),
      differentiator: z.string(),
    })
    .nullable(),
  question: z.string(),
});

export function makeInterviewNode(deps: { llm: LlmProvider; askMax: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // A re-run of the wizard resumes what it learned; the owner is not
    // interrogated twice.
    if (state.profile) return { phase: 'generating' };

    const result = await deps.llm.structured({
      system: INTERVIEW_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: InterviewResultSchema,
      name: 'business_interview',
    });

    const profile = result.profile ? BusinessProfileSchema.safeParse(result.profile) : null;
    const requirements = result.requirements
      ? BusinessRequirementsSchema.safeParse(result.requirements)
      : null;

    // The floor: `satisfied` is worth nothing without a profile that parses.
    // A model that declares victory on "hi" does not get to.
    const grounded = profile?.success === true;
    const atCap = state.questionCount + 1 >= deps.askMax;

    if (grounded && (result.satisfied || atCap)) {
      return {
        phase: 'generating',
        profile: profile.data,
        // Partial requirements stay null: downstream builds no plan rather
        // than a plan from half-known facts.
        requirements: requirements?.success ? requirements.data : null,
      };
    }

    const question = result.question.trim() || 'What kind of business are you setting up?';
    return {
      phase: 'gathering',
      questionCount: state.questionCount + 1,
      messages: [new AIMessage(question)],
    };
  };
}
```

Delete `profile-check.node.ts` and `profile-check.node.test.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/agents test -- interview.node`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/src/onboarding
git commit -m "feat(agents): adaptive interview node with a floor and a question cap"
```

---

### Task 4: The `inferNeeds` node

**Files:**
- Create: `apps/agents/src/onboarding/nodes/infer-needs.node.ts`
- Create: `apps/agents/src/onboarding/nodes/infer-needs.node.test.ts`
- Modify: `apps/agents/src/onboarding/prompts.ts`

**Interfaces:**
- Consumes: `SetupPlanSchema`, `FieldProposalSchema`, `SellsWhatSchema` from Task 1; `OnboardingState` from Task 2.
- Produces: `makeInferNeedsNode(deps: { llm: LlmProvider; maxAttempts: number })` returning `(state: OnboardingState) => Promise<Partial<OnboardingState>>`.

- [ ] **Step 1: Write the failing tests**

Create `apps/agents/src/onboarding/nodes/infer-needs.node.test.ts`:

```ts
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { defaultOnboardingState } from '../state';
import { makeInferNeedsNode } from './infer-needs.node';

const requirements = {
  sellsWhat: 'bookable' as const,
  categories: ['classes', 'retreats'],
  fulfilment: 'in person at the studio',
  priceBand: 'mid',
  differentiator: 'small groups',
};

const state = (over = {}) => ({
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
        { entity: 'Event', field: { name: 'durationMinutes', type: 'number' }, rationale: 'classes vary' },
      ],
    });

    const next = await node(state());

    expect(next.setupPlan?.sellsWhat).toBe('bookable');
    expect(next.setupPlan?.fields).toHaveLength(1);
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

  it('falls back to the stated sellsWhat when the model contradicts it', async () => {
    llm.pushStructured({ sellsWhat: 'nonsense', categories: [], fields: [] });

    const next = await node(state());

    expect(next.setupPlan?.sellsWhat).toBe('bookable');
  });

  it('produces no plan when requirements were never completed', async () => {
    const next = await node(state({ requirements: null }));

    expect(next.setupPlan).toBeNull();
    expect(llm.calls).toHaveLength(0);
  });

  it('gives up after maxAttempts and leaves the plan null rather than failing the run', async () => {
    llm.pushStructured({ sellsWhat: 'bookable', categories: [], fields: 'not-an-array' });
    llm.pushStructured({ sellsWhat: 'bookable', categories: [], fields: 'not-an-array' });
    llm.pushStructured({ sellsWhat: 'bookable', categories: [], fields: 'not-an-array' });

    const next = await node(state());

    expect(next.setupPlan).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/agents test -- infer-needs`
Expected: FAIL — cannot resolve `./infer-needs.node`.

- [ ] **Step 3: Write the prompt**

Append to `apps/agents/src/onboarding/prompts.ts`:

```ts
export const NEEDS_SYSTEM = `You are setting up the shop for the business described below.
Decide what it needs to record that a default shop cannot:
- sellsWhat: "goods" if they ship or hand over physical items, "bookable" if customers book a
  place at a class, session or event, "both" when they genuinely do each.
- categories: up to 8 short lowercase category names for what they offer. Real groupings from
  the conversation, not invented breadth.
- fields: up to 6 extra fields, each on Product, Order, Event or Booking, that this business
  needs and a generic shop does not. Give each a one-line rationale in the owner's terms.
Fields are ADD-ONLY and may not reuse a name the entity already has: Product already has name,
description, priceMinor, currency, category, stock, images and status; Event already has title,
capacity, bookedCount, startDate, endDate and basePriceMinor; Booking already has eventId,
userId, status and ticketQuantity; Order already has userId, status, totalAmountMinor, currency,
items and shippingAddress. Field types are one of: string, number, boolean, date, string[],
number[], boolean[], date[]. Propose nothing you cannot justify from what the owner said.`;
```

- [ ] **Step 4: Write the node**

Create `apps/agents/src/onboarding/nodes/infer-needs.node.ts`:

```ts
import { z } from 'zod';
import { FieldProposalSchema, SellsWhatSchema, SetupPlanSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { toChatMessages } from '../../graph/state';
import { OnboardingState } from '../state';
import { NEEDS_SYSTEM } from '../prompts';

/** Loose, like the other generative nodes: validated against the contracts below. */
const NeedsResultSchema = z.object({
  sellsWhat: z.string(),
  categories: z.array(z.string()),
  fields: z.array(
    z.object({
      entity: z.string(),
      field: z.object({
        name: z.string(),
        type: z.string(),
        required: z.boolean().optional(),
        default: z.unknown().nullable().optional(),
      }),
      rationale: z.string().optional(),
    }),
  ),
});

export function makeInferNeedsNode(deps: { llm: LlmProvider; maxAttempts: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    // No requirements means the interview hit its cap without completing them.
    // The storefront still drafts; there is simply nothing to propose.
    if (!state.requirements) return { setupPlan: null };

    const context = JSON.stringify({ profile: state.profile, requirements: state.requirements });

    for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
      let result: z.infer<typeof NeedsResultSchema>;
      try {
        result = await deps.llm.structured({
          system: `${NEEDS_SYSTEM}\n\nBusiness: ${context}`,
          messages: toChatMessages(state.messages),
          schema: NeedsResultSchema,
          name: 'setup_plan',
        });
      } catch {
        continue;
      }

      // Per-proposal, not all-or-nothing: one bad field name must not cost the
      // owner their whole plan.
      const fields = result.fields
        .map((raw) =>
          FieldProposalSchema.safeParse({
            entity: raw.entity,
            field: {
              name: raw.field.name,
              type: raw.field.type,
              required: raw.field.required ?? false,
              default: raw.field.default ?? null,
            },
            rationale: (raw.rationale ?? '').slice(0, 200),
          }),
        )
        .filter((parsed) => parsed.success)
        .map((parsed) => parsed.data)
        .slice(0, 6);

      const sellsWhat = SellsWhatSchema.safeParse(result.sellsWhat);

      const plan = SetupPlanSchema.safeParse({
        // The owner's own answer wins over a model that contradicts it.
        sellsWhat: sellsWhat.success ? sellsWhat.data : state.requirements.sellsWhat,
        categories: (result.categories.length ? result.categories : state.requirements.categories)
          .map((c) => c.trim())
          .filter(Boolean)
          .slice(0, 8),
        fields,
      });

      if (plan.success) return { setupPlan: plan.data };
    }

    // A plan is a bonus, not the run. The storefront draft still ships.
    return { setupPlan: null };
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/agents test -- infer-needs`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/src/onboarding
git commit -m "feat(agents): infer a setup plan from gathered requirements"
```

---

### Task 5: Wire both nodes into the graph

**Files:**
- Modify: `apps/agents/src/onboarding/onboarding-graph.service.ts`
- Test: `apps/agents/src/onboarding/onboarding-graph.service.int-test.ts`

**Interfaces:**
- Consumes: `makeInterviewNode`, `ASK_MAX` (Task 3), `makeInferNeedsNode` (Task 4).
- Produces: a graph whose snapshot carries `setupPlan`.

- [ ] **Step 1: Write the failing int-test**

Append to `apps/agents/src/onboarding/onboarding-graph.service.int-test.ts`, following the queueing style already used in that file:

```ts
it('interviews, then returns a drafted snapshot carrying a setup plan', async () => {
  llm.pushStructured({
    satisfied: false,
    profile: null,
    requirements: null,
    question: 'Do you sell items or run classes?',
  });

  const asked = await service.run({ threadId, ctx, content: 'I run a yoga studio' });
  expect(asked.phase).toBe('gathering');
  expect(asked.setupPlan).toBeNull();

  llm.pushStructured({
    satisfied: true,
    profile: { kind: 'yoga studio', name: 'Nimbus', tone: 'calm', audience: 'locals' },
    requirements: {
      sellsWhat: 'bookable',
      categories: ['classes'],
      fulfilment: 'in person',
      priceBand: 'mid',
      differentiator: 'small groups',
    },
    question: '',
  });
  llm.pushStructured({
    sellsWhat: 'bookable',
    categories: ['classes'],
    fields: [
      { entity: 'Event', field: { name: 'durationMinutes', type: 'number' }, rationale: 'varies' },
    ],
  });
  llm.pushStructured({ presetId: 'studio' });
  llm.pushStructured({
    about: { title: 'Nimbus', sections: [{ heading: 'Who', body: 'Us' }] },
    banners: [{ slot: 'hero', headline: 'Breathe', subline: 'Classes weekly', ctaHref: '/events' }],
  });

  const drafted = await service.run({ threadId, ctx, content: 'classes, in person, small groups' });

  expect(drafted.phase).toBe('drafted');
  expect(drafted.setupPlan?.fields[0].field.name).toBe('durationMinutes');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/agents test -- onboarding-graph`
Expected: FAIL — snapshot has no `setupPlan`, and the graph never calls the needs prompt.

- [ ] **Step 3: Rewire the graph**

In `apps/agents/src/onboarding/onboarding-graph.service.ts`, swap the imports of `makeProfileCheckNode` for `makeInterviewNode`/`ASK_MAX` and add `makeInferNeedsNode`, then replace the node registration and the two conditional edges:

```ts
      .addNode('interview', makeInterviewNode({ llm: this.llm, askMax: ASK_MAX }))
      .addNode(
        'inferNeeds',
        makeInferNeedsNode({ llm: this.llm, maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }),
      )
```

```ts
      // A message to a drafted thread is feedback: regenerate with history,
      // profile and plan already known. A fresh or gathering thread starts
      // with the interview.
      .addConditionalEdges(START, (state: OnboardingState) =>
        state.phase === 'drafted' ? 'proposeTheme' : 'interview',
      )
      .addConditionalEdges('interview', (state: OnboardingState) =>
        state.phase === 'gathering' ? END : 'inferNeeds',
      )
      .addEdge('inferNeeds', 'proposeTheme')
```

Leave `proposeTheme → draftContent → assembleDraft → dispatchDraft → END` exactly as they are.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/agents test -- onboarding-graph`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `pnpm --filter @marketplace/agents build`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/src/onboarding
git commit -m "feat(agents): route onboarding through interview and needs inference"
```

---

### Task 6: Apply endpoint on the agents service

**Files:**
- Create: `apps/agents/src/setup-plan/setup-plan.service.ts`
- Create: `apps/agents/src/setup-plan/setup-plan.service.test.ts`
- Create: `apps/agents/src/setup-plan/setup-plan.controller.ts`
- Create: `apps/agents/src/setup-plan/setup-plan.module.ts`
- Modify: `apps/agents/src/engine-client/engine.client.ts`
- Modify: `apps/agents/src/app.module.ts`

**Interfaces:**
- Consumes: `ApplySetupPlanRequest`/`ApplySetupPlanResponse` (Task 1), `DispatchService.dispatch`, `EngineClient.putStorefrontDraft`.
- Produces: `EngineClient.getStorefrontDraft(token): Promise<StorefrontConfig | null>`; `SetupPlanService.apply(req, principal, token): Promise<ApplySetupPlanResponse>`; `POST /setup-plan/apply`.

- [ ] **Step 1: Write the failing service tests**

Create `apps/agents/src/setup-plan/setup-plan.service.test.ts`:

```ts
import { ProblemException } from '../common/problem';
import { SetupPlanService } from './setup-plan.service';

const draft = {
  presetId: 'artisan',
  overrides: {},
  about: { title: 'A', sections: [{ heading: 'H', body: 'B' }] },
  banners: [],
  businessProfile: { kind: 'pottery', name: 'Kiln', tone: 'warm', audience: 'gift buyers' },
};

const admin = { tenantId: 'acme', userId: 'u1', role: 'admin' as const };
const req = {
  sellsWhat: 'goods' as const,
  categories: ['mugs'],
  fields: [
    { entity: 'Product' as const, field: { name: 'material', type: 'string' as const, required: false, default: null } },
  ],
};

describe('SetupPlanService', () => {
  let engine: { getStorefrontDraft: jest.Mock; putStorefrontDraft: jest.Mock };
  let dispatch: { dispatch: jest.Mock };
  let service: SetupPlanService;

  beforeEach(() => {
    engine = {
      getStorefrontDraft: jest.fn().mockResolvedValue(draft),
      putStorefrontDraft: jest.fn().mockResolvedValue(undefined),
    };
    dispatch = { dispatch: jest.fn().mockResolvedValue('msg-1') };
    service = new SetupPlanService(engine as never, dispatch as never);
  });

  it('refuses a caller who is not an admin, in the service and not only the decorator', async () => {
    await expect(
      service.apply(req, { ...admin, role: 'buyer' }, 'tok'),
    ).rejects.toBeInstanceOf(ProblemException);
    expect(engine.putStorefrontDraft).not.toHaveBeenCalled();
  });

  it('merges the storefront half into the existing draft', async () => {
    await service.apply(req, admin, 'tok');

    const [config] = engine.putStorefrontDraft.mock.calls[0];
    expect(config.sellsWhat).toBe('goods');
    expect(config.categories).toEqual(['mugs']);
    expect(config.about).toEqual(draft.about);
  });

  it('writes the storefront before dispatching any field', async () => {
    const order: string[] = [];
    engine.putStorefrontDraft.mockImplementation(async () => void order.push('put'));
    dispatch.dispatch.mockImplementation(async () => {
      order.push('dispatch');
      return 'msg-1';
    });

    await service.apply(req, admin, 'tok');

    expect(order).toEqual(['put', 'dispatch']);
  });

  it('queues nothing when the storefront write fails', async () => {
    engine.putStorefrontDraft.mockRejectedValue(
      new ProblemException('engine-unavailable', 503, 'down'),
    );

    await expect(service.apply(req, admin, 'tok')).rejects.toBeInstanceOf(ProblemException);
    expect(dispatch.dispatch).not.toHaveBeenCalled();
  });

  it('reports a failed dispatch per item and keeps the storefront half applied', async () => {
    dispatch.dispatch.mockRejectedValue(new ProblemException('dispatch-failed', 502, 'queue down'));

    const result = await service.apply(req, admin, 'tok');

    expect(result.applied.categories).toEqual(['mugs']);
    expect(result.queued).toEqual([]);
    expect(result.failed[0]).toMatchObject({ entity: 'Product', fieldName: 'material' });
  });

  it('reports each queued field with its message id', async () => {
    const result = await service.apply(req, admin, 'tok');

    expect(result.queued).toEqual([
      { entity: 'Product', fieldName: 'material', messageId: 'msg-1' },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/agents test -- setup-plan.service`
Expected: FAIL — cannot resolve `./setup-plan.service`.

- [ ] **Step 3: Add the engine read**

In `apps/agents/src/engine-client/engine.client.ts`, beside `putStorefrontDraft`:

```ts
  /**
   * The draft the wizard is working on. Read for a read-modify-write: the
   * setup plan merges two keys into it and PUTs the whole document back, the
   * same whole-document write the graph makes.
   */
  async getStorefrontDraft(token: string): Promise<StorefrontConfig | null> {
    const body = await this.get('/api/v1/storefront/draft', token);
    return body.draft === null || body.draft === undefined
      ? null
      : StorefrontConfigSchema.parse(body.draft);
  }
```

Add `StorefrontConfigSchema` to the imports from `@marketplace/contracts`.

- [ ] **Step 4: Write the service**

Create `apps/agents/src/setup-plan/setup-plan.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { TenantPrincipal } from '@marketplace/auth';
import { ApplySetupPlanRequest, ApplySetupPlanResponse } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { DispatchService } from '../dispatch/dispatch.service';
import { EngineClient } from '../engine-client/engine.client';

@Injectable()
export class SetupPlanService {
  constructor(
    private readonly engine: EngineClient,
    private readonly dispatch: DispatchService,
  ) {}

  async apply(
    request: ApplySetupPlanRequest,
    principal: TenantPrincipal,
    token: string,
  ): Promise<ApplySetupPlanResponse> {
    // Checked here as well as declared on the route: the decorator documents
    // the restriction, this is what protects a non-HTTP caller.
    if (principal.role !== 'admin') {
      throw new ProblemException('not-found', 404, 'Not Found', 'no such resource');
    }

    const draft = await this.engine.getStorefrontDraft(token);
    if (!draft) {
      throw new ProblemException(
        'not-found',
        404,
        'Not Found',
        'there is no storefront draft to apply a setup plan to',
      );
    }

    // Storefront first. If this throws, nothing is queued -- no field
    // additions for a shop whose type never took.
    await this.engine.putStorefrontDraft(
      { ...draft, sellsWhat: request.sellsWhat, categories: request.categories },
      token,
    );

    const queued: ApplySetupPlanResponse['queued'] = [];
    const failed: ApplySetupPlanResponse['failed'] = [];

    for (const { entity, field } of request.fields) {
      try {
        const messageId = await this.dispatch.dispatch({
          // The thread is the tenant's setup plan rather than a chat thread:
          // stable per tenant, so a double-clicked Apply lands inside the
          // queue's deduplication window instead of proposing twice.
          threadId: `setup-plan:${principal.tenantId}`,
          tenantId: principal.tenantId,
          targetEntity: entity,
          payload: { addedFields: [field] },
        });
        queued.push({ entity, fieldName: field.name, messageId });
      } catch (err) {
        // A partial success is not an error: the owner is told exactly which
        // half happened rather than being handed one aggregate failure.
        failed.push({
          entity,
          fieldName: field.name,
          reason: err instanceof ProblemException ? err.problem.detail ?? err.problem.title : 'dispatch failed',
        });
      }
    }

    return {
      applied: { sellsWhat: request.sellsWhat, categories: request.categories },
      queued,
      failed,
    };
  }
}
```

`ProblemException` in `apps/agents/src/common/problem.ts` exposes `readonly problem: ProblemBody`, where `detail` is optional and `title` always present — so `err.problem.detail ?? err.problem.title` is the correct narrowing. `not-found` and `dispatch-failed` are both already members of `AgentProblemType`; this task adds no new union member.

- [ ] **Step 5: Run the service tests to verify they pass**

Run: `pnpm --filter @marketplace/agents test -- setup-plan.service`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the controller and module**

Create `apps/agents/src/setup-plan/setup-plan.controller.ts`:

```ts
import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApplySetupPlanRequestSchema, ApplySetupPlanResponse } from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { Roles } from '../auth/roles.decorator';
import { getTenantPrincipal } from '../auth/request-principal';
import { SetupPlanService } from './setup-plan.service';

@Controller('setup-plan')
export class SetupPlanController {
  constructor(private readonly setupPlan: SetupPlanService) {}

  // 200, not 201: the storefront draft is updated in place and the field
  // additions become proposals, so nothing is created at this URL.
  @Post('apply')
  @Roles('admin')
  @HttpCode(200)
  apply(
    @Body() body: unknown,
    @Req() req: object,
    // The guard has already verified this token; re-used verbatim so the
    // engine applies the caller's own scoping to the draft write.
    @Headers('authorization') authorization: string | undefined,
  ): Promise<ApplySetupPlanResponse> {
    const parsed = ApplySetupPlanRequestSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-request',
        400,
        'Invalid setup plan',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }

    const principal = getTenantPrincipal(req);
    if (!principal) {
      throw new ProblemException('unauthorized', 401, 'Unauthorized');
    }

    const token = authorization?.replace(/^Bearer\s+/i, '') ?? '';
    return this.setupPlan.apply(parsed.data, principal, token);
  }
}
```

Create `apps/agents/src/setup-plan/setup-plan.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { DispatchModule } from '../dispatch/dispatch.module';
import { EngineClientModule } from '../engine-client/engine-client.module';
import { SetupPlanController } from './setup-plan.controller';
import { SetupPlanService } from './setup-plan.service';

@Module({
  imports: [EngineClientModule, DispatchModule],
  controllers: [SetupPlanController],
  providers: [SetupPlanService],
})
export class SetupPlanModule {}
```

If `DispatchModule` does not already export `DispatchService`, add it to that module's `exports` array — `EngineClientModule` already exports `EngineClient` for the graph. Register `SetupPlanModule` in `apps/agents/src/app.module.ts`'s `imports`, beside `CopywriterModule` and `SupportModule`.

- [ ] **Step 7: Build and run the agents suite**

Run: `pnpm --filter @marketplace/agents build && pnpm --filter @marketplace/agents test`
Expected: build clean, suite green. If a suite is red, re-run it alone before believing it.

- [ ] **Step 8: Commit**

```bash
git add apps/agents/src/setup-plan apps/agents/src/engine-client apps/agents/src/app.module.ts
git commit -m "feat(agents): apply a setup plan, storefront first then queued field proposals"
```

---

### Task 7: Setup tab in the wizard

**Files:**
- Modify: `apps/web/lib/api/agents.ts`
- Create: `apps/web/app/(admin)/admin/onboarding/setup-tab.tsx`
- Create: `apps/web/app/(admin)/admin/onboarding/setup-tab.test.tsx`
- Modify: `apps/web/app/(admin)/admin/onboarding/preview-pane.tsx:15,181-189`
- Modify: `apps/web/app/(admin)/admin/onboarding/page.tsx`

**Interfaces:**
- Consumes: `SetupPlan`, `ApplySetupPlanResponse` (Task 1); `request` and `AGENTS_URL` from `apps/web/lib/api`.
- Produces: `applySetupPlan(body: ApplySetupPlanRequest): Promise<ApplySetupPlanResponse>`; `<SetupTab plan={SetupPlan} />`; `PreviewPane` accepts a `setupPlan` prop and adds a `'setup'` tab.

- [ ] **Step 1: Write the failing component tests**

Create `apps/web/app/(admin)/admin/onboarding/setup-tab.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SetupTab } from './setup-tab';

const applySetupPlan = vi.fn();
vi.mock('../../../../lib/api/agents', () => ({ applySetupPlan: (b: unknown) => applySetupPlan(b) }));

const plan = {
  sellsWhat: 'bookable' as const,
  categories: ['classes', 'retreats'],
  fields: [
    {
      entity: 'Event' as const,
      field: { name: 'durationMinutes', type: 'number' as const, required: false, default: null },
      rationale: 'classes vary in length',
    },
  ],
};

describe('SetupTab', () => {
  it('shows each proposed field with its rationale', () => {
    render(<SetupTab plan={plan} />);
    expect(screen.getByText(/durationMinutes/)).toBeInTheDocument();
    expect(screen.getByText(/classes vary in length/)).toBeInTheDocument();
  });

  it('omits an unticked field from the request', async () => {
    applySetupPlan.mockResolvedValue({
      applied: { sellsWhat: 'bookable', categories: ['classes', 'retreats'] },
      queued: [],
      failed: [],
    });

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /durationMinutes/ }));
    await userEvent.click(screen.getByRole('button', { name: /Apply setup/ }));

    await waitFor(() => expect(applySetupPlan).toHaveBeenCalled());
    expect(applySetupPlan.mock.calls[0][0].fields).toEqual([]);
  });

  it('renders queued and failed results distinctly', async () => {
    applySetupPlan.mockResolvedValue({
      applied: { sellsWhat: 'bookable', categories: ['classes'] },
      queued: [{ entity: 'Event', fieldName: 'durationMinutes', messageId: 'm1' }],
      failed: [{ entity: 'Event', fieldName: 'level', reason: 'queue down' }],
    });

    render(<SetupTab plan={plan} />);
    await userEvent.click(screen.getByRole('button', { name: /Apply setup/ }));

    expect(await screen.findByText(/sent to Flows/i)).toBeInTheDocument();
    expect(await screen.findByText(/level/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Review in Flows/i })).toHaveAttribute(
      'href',
      '/admin/flows',
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/web test -- setup-tab`
Expected: FAIL — cannot resolve `./setup-tab`.

- [ ] **Step 3: Add the API client call**

Append to `apps/web/lib/api/agents.ts`:

```ts
/** Applies the owner's confirmed subset: storefront keys now, field additions as proposals. */
export const applySetupPlan = (body: ApplySetupPlanRequest) =>
  request('/api/v1/setup-plan/apply', {
    method: 'POST',
    body,
    schema: ApplySetupPlanResponseSchema,
    base: AGENTS_URL,
  });
```

Add `ApplySetupPlanResponseSchema` and `type ApplySetupPlanRequest` to that file's `@marketplace/contracts` import.

- [ ] **Step 4: Write the component**

Create `apps/web/app/(admin)/admin/onboarding/setup-tab.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Checkbox, Radio, Space, Tag } from 'antd';
import type { ApplySetupPlanResponse, SellsWhat, SetupPlan } from '@marketplace/contracts';
import { applySetupPlan } from '../../../../lib/api/agents';
import { notifyProblem } from '../../../../lib/problem-notify';

const fieldKey = (entity: string, name: string) => `${entity}.${name}`;

/**
 * The agent's proposal, as a form the owner edits by unticking. Nothing is
 * sent until Apply. No Popconfirm: this writes a private draft and queues
 * proposals a human still executes -- Publish is the one that goes public.
 */
export function SetupTab({ plan }: { plan: SetupPlan }) {
  const [sellsWhat, setSellsWhat] = useState<SellsWhat>(plan.sellsWhat);
  const [categories, setCategories] = useState<string[]>(plan.categories);
  const [fields, setFields] = useState<string[]>(
    plan.fields.map((f) => fieldKey(f.entity, f.field.name)),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplySetupPlanResponse | null>(null);

  const apply = async () => {
    setBusy(true);
    try {
      setResult(
        await applySetupPlan({
          sellsWhat,
          categories,
          fields: plan.fields
            .filter((f) => fields.includes(fieldKey(f.entity, f.field.name)))
            .map((f) => ({ entity: f.entity, field: f.field })),
        }),
      );
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="mp-setup-result" data-testid="setup-result">
        <p>
          Storefront set to {result.applied.sellsWhat}
          {result.applied.categories.length > 0 &&
            ` · categories saved: ${result.applied.categories.join(', ')}`}
        </p>
        {result.queued.length > 0 && (
          <p>
            {result.queued.length} field addition{result.queued.length === 1 ? '' : 's'} sent to
            Flows for approval:{' '}
            {result.queued.map((q) => `${q.entity}.${q.fieldName}`).join(', ')}
          </p>
        )}
        {result.failed.length > 0 && (
          <p role="alert">
            Could not queue: {result.failed.map((f) => `${f.entity}.${f.fieldName}`).join(', ')}
          </p>
        )}
        <Link href="/admin/flows">Review in Flows</Link>
      </div>
    );
  }

  return (
    <div className="mp-setup-plan">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <h4>What this shop sells</h4>
          <Radio.Group value={sellsWhat} onChange={(e) => setSellsWhat(e.target.value as SellsWhat)}>
            <Radio value="goods">Products</Radio>
            <Radio value="bookable">Bookable events</Radio>
            <Radio value="both">Both</Radio>
          </Radio.Group>
        </div>

        {plan.categories.length > 0 && (
          <div>
            <h4>Categories</h4>
            <Checkbox.Group
              value={categories}
              onChange={(next) => setCategories(next as string[])}
              options={plan.categories.map((c) => ({ label: <Tag>{c}</Tag>, value: c }))}
            />
          </div>
        )}

        {plan.fields.length > 0 && (
          <div>
            <h4>Extra fields</h4>
            <Checkbox.Group value={fields} onChange={(next) => setFields(next as string[])}>
              <Space direction="vertical">
                {plan.fields.map((f) => {
                  const key = fieldKey(f.entity, f.field.name);
                  return (
                    <Checkbox key={key} value={key}>
                      {f.entity}.{f.field.name} <Tag>{f.field.type}</Tag>
                      <span className="mp-muted"> — {f.rationale}</span>
                    </Checkbox>
                  );
                })}
              </Space>
            </Checkbox.Group>
          </div>
        )}

        <Button type="primary" loading={busy} onClick={apply} data-testid="apply-setup">
          Apply setup
        </Button>
      </Space>
    </div>
  );
}
```

- [ ] **Step 5: Wire it into the preview pane**

In `apps/web/app/(admin)/admin/onboarding/preview-pane.tsx`, widen the tab union at line 15:

```ts
type Tab = 'storefront' | 'about' | 'banners' | 'setup';
```

Add `setupPlan` to the component's props (`setupPlan: SetupPlan | null`), append the option conditionally in the `Segmented` at lines 181-189:

```tsx
          ...(setupPlan ? [{ label: 'Setup', value: 'setup' }] : []),
```

and render `{tab === 'setup' && setupPlan && <SetupTab plan={setupPlan} />}` beside the existing tab bodies.

In `apps/web/app/(admin)/admin/onboarding/page.tsx`, pass it through from the snapshot:

```tsx
          <PreviewPane
            draft={config}
            setupPlan={snapshot?.setupPlan ?? null}
            onChange={(next) => void applyEdit(next)}
            imageGen={imageGen}
          />
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/web test -- setup-tab`
Expected: PASS, 3 tests.

- [ ] **Step 7: Build the web app**

Run: `pnpm --filter @marketplace/web build`
Expected: no type errors and no lint failures. A change that passes vitest can still fail this.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): setup tab proposing sellsWhat, categories and fields"
```

---

### Task 8: Optimistic echo and pending indicator

**Files:**
- Modify: `apps/web/lib/chat/use-onboarding-socket.ts:63-70`
- Modify: `apps/web/app/(admin)/admin/onboarding/page.tsx`
- Test: `apps/web/lib/chat/use-onboarding-socket.test.ts`

**Interfaces:**
- Produces: `useOnboardingSocket()` additionally returns `pending: boolean` and includes an optimistic user message in `snapshot.messages` until the next server snapshot replaces it.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/lib/chat/use-onboarding-socket.test.ts` (follow the existing mock-socket setup in that file):

```ts
it('shows the user message immediately and clears it when the server snapshot arrives', async () => {
  const { result } = renderHook(() => useOnboardingSocket());
  act(() => emitConnect());
  act(() => emitState({ threadId: ulid, kind: 'onboarding', phase: 'gathering', messages: [], draft: null, setupPlan: null }));

  act(() => result.current.send('I run a pottery studio'));

  expect(result.current.pending).toBe(true);
  expect(result.current.snapshot?.messages.at(-1)).toEqual({
    role: 'user',
    content: 'I run a pottery studio',
  });

  act(() =>
    emitState({
      threadId: ulid,
      kind: 'onboarding',
      phase: 'gathering',
      messages: [
        { role: 'user', content: 'I run a pottery studio' },
        { role: 'assistant', content: 'What do you sell?' },
      ],
      draft: null,
      setupPlan: null,
    }),
  );

  expect(result.current.pending).toBe(false);
  expect(result.current.snapshot?.messages).toHaveLength(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- use-onboarding-socket`
Expected: FAIL — `pending` is undefined.

- [ ] **Step 3: Implement**

In `apps/web/lib/chat/use-onboarding-socket.ts`, hold the optimistic message in state, clear it whenever a server snapshot lands, and expose `pending`:

```ts
  const [optimistic, setOptimistic] = useState<string | null>(null);
```

Inside the existing `socket.on(AGENT_EVENTS.state, ...)` handler, after `setSnapshot(parsed.data)`:

```ts
      // The server snapshot is authoritative: it already contains the user's
      // message, so the optimistic copy is dropped wholesale rather than
      // reconciled.
      setOptimistic(null);
```

Change `send` to record it:

```ts
  const send = useCallback(
    (content: string) => {
      if (!threadId) return;
      setOptimistic(content);
      socketRef.current?.emit(AGENT_EVENTS.message, { threadId, content });
    },
    [threadId],
  );
```

Return a snapshot with the optimistic message appended, and the flag:

```ts
  const withOptimistic =
    snapshot && optimistic
      ? { ...snapshot, messages: [...snapshot.messages, { role: 'user' as const, content: optimistic }] }
      : snapshot;

  return { snapshot: withOptimistic, connected, error, send, pending: optimistic !== null };
```

In `apps/web/app/(admin)/admin/onboarding/page.tsx`, take `pending` from the hook and render an indicator under the message list while it is true:

```tsx
            {pending && (
              <div className="mp-msg" data-role="assistant" data-testid="pending">
                <span className="mp-msg-avatar" aria-hidden="true">
                  <RobotOutlined />
                </span>
                <div className="mp-msg-bubble">Thinking…</div>
              </div>
            )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- use-onboarding-socket`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/chat apps/web/app
git commit -m "fix(web): echo the owner's message and show a pending turn"
```

---

### Task 9: Consume `sellsWhat` and `categories`

**Files:**
- Modify: `apps/web/app/(admin)/admin/products/new/page.tsx` and `apps/web/app/(admin)/admin/products/[id]/edit/page.tsx` (category input)
- Modify: `apps/web/components/shop-header.tsx` (nav order)
- Modify: `apps/web/app/(admin)/admin/onboarding/preview-pane.tsx` (placeholder grid)
- Test: `apps/web/app/(admin)/admin/onboarding/preview-pane.test.tsx`

**Interfaces:**
- Consumes: `StorefrontConfig.sellsWhat`, `StorefrontConfig.categories` (Task 1); `getPublishedStorefront` from `apps/web/lib/api/storefront.ts`.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/app/(admin)/admin/onboarding/preview-pane.test.tsx`:

```tsx
it('suppresses the placeholder product grid for a bookable shop', () => {
  render(
    <PreviewPane
      draft={{ ...draftFixture, sellsWhat: 'bookable' }}
      setupPlan={null}
      onChange={() => {}}
      imageGen={false}
    />,
  );
  expect(screen.queryByText('Product One')).not.toBeInTheDocument();
});

it('still shows it for a goods shop', () => {
  render(
    <PreviewPane
      draft={{ ...draftFixture, sellsWhat: 'goods' }}
      setupPlan={null}
      onChange={() => {}}
      imageGen={false}
    />,
  );
  expect(screen.getByText('Product One')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- preview-pane`
Expected: FAIL — "Product One" is rendered unconditionally.

- [ ] **Step 3: Implement**

In `preview-pane.tsx`, gate the three-up placeholder grid on `draft.sellsWhat !== 'bookable'`. A yoga studio showing `Product One / Product Two / Product Three` is the visible symptom this whole change exists to remove.

In the product form pages, pass the published storefront's `categories` as the category input's suggestions using antd `AutoComplete`, keeping the field free text — a category the owner types must not be rejected for being absent from the list:

```tsx
<AutoComplete
  options={(storefront?.categories ?? []).map((c) => ({ value: c }))}
  filterOption={(input, option) =>
    (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
  }
/>
```

In `apps/web/components/shop-header.tsx`, order the Products and Events links from the published config: Events first when `sellsWhat === 'bookable'`, Products first otherwise (including when `sellsWhat` is absent, which is every shop that predates this feature). Read the **published** config via `getPublishedStorefront`, never the draft, so nothing a customer sees changes until the owner publishes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/web test -- preview-pane`
Expected: PASS.

- [ ] **Step 5: Build**

Run: `pnpm --filter @marketplace/web build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): storefront and product form honour sellsWhat and categories"
```

---

### Task 10: Whole-system verification

**Files:**
- Modify: `apps/web/test/e2e/onboarding.spec.ts` (or create it, matching the naming of the existing specs in that directory)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Rebuild the two changed containers**

```bash
docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine agents web
```

A full `pnpm docker:up` spends most of its time waiting for the agents container to pull its ollama model, which these changes cannot have invalidated.

- [ ] **Step 2: Write the browser journey**

Add a spec that signs in as an admin for a run-scoped tenant, opens `/admin/onboarding`, answers until a draft appears, opens the **Setup** tab, unticks one field, clicks **Apply setup**, and asserts the result view names the queued fields and that `/admin/flows` lists the corresponding proposals. Use `signIn` from `apps/web/test/e2e/helpers/session.ts` and the run-scoped personas written by `global-setup.ts` — do not use the seeded demo tenant, whose storefront other specs assert on.

Base URL stays on `localhost` (the page's origin must match what the engine allows); any host-side HTTP the spec performs uses the `127.0.0.1` literal, because Chromium does not fall back from a stalled IPv6 loopback.

- [ ] **Step 3: Run the journey**

Run: `pnpm --filter @marketplace/web e2e:journeys`
Expected: PASS. Re-run a red spec alone before believing it.

- [ ] **Step 4: Look at it**

Open `/admin/onboarding` in a browser, run an interview through to a plan, and screenshot the Setup tab and the applied result. Passing tests prove behaviour, not appearance — two real defects in the order-stages work were only ever going to be found in a screenshot. Check specifically that the field list is readable at the pane's width and that the rationale text does not crowd the checkbox.

- [ ] **Step 5: Full gate**

```bash
npx turbo run test --concurrency=1
pnpm --filter @marketplace/engine build
pnpm --filter @marketplace/agents build
pnpm --filter @marketplace/web build
```

Expected: all green. A parallel run produces false failures; re-run any red suite on its own before believing it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/test/e2e
git commit -m "test(web): browser journey for interview, setup plan and apply"
```

---

## Notes for the executor

- **`ASK_MAX` is 5.** Against the local CPU ollama at ~10 tok/s this means a couple of minutes to first draft. If that makes the browser journey flaky on timeouts, raise the spec's Playwright timeout rather than lowering the cap — the cap is a product decision, recorded in the spec.
- **The two known socket bugs are deliberately out of scope**: a reply completed during a reload is never delivered to the reconnected socket, and a second tab on the same tenant starts a fresh thread rather than resuming. Do not fix them here; they have their own spec to be written.
- **Do not widen `BusinessProfileSchema`.** It is embedded in every stored `StorefrontConfig`, which is strict. That is why `BusinessRequirements` exists as a sibling.
