# Owner-Defined Order Stages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shop owner defines the stages an order passes through — their own names, count and order — with per-stage cancellation and per-stage buyer↔seller message threads, rendered on the storefront.

**Architecture:** The pipeline is one tenant-settings record, versioned. An order copies the stage list at creation and walks that copy forever, so an owner's later edit can never reach an order in flight. `OrderStatusSchema` is untouched — stages sit beside `status`. Stock restoration on cancel is a DynamoDB transaction that mirrors `create`'s, conditioned on both the status and the stage id.

**Tech Stack:** TypeScript, NestJS, DynamoDB single-table (`@aws-sdk/lib-dynamodb`), Zod contracts shared across services, Next.js 15 + React 19 + antd 5, Jest (engine), Vitest + Testing Library (web), Playwright (journeys), pnpm + turbo.

**Spec:** `docs/superpowers/specs/2026-08-18-order-stages-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **Run tests as `npx turbo run test --concurrency=1`.** Parallel runs on this machine produce false red suites. Re-run a red suite alone before believing it.
- **Host-side test harnesses use `127.0.0.1`, never `localhost`.** `localhost` resolves to `::1` first here and Docker's IPv6 loopback proxy drops. Browser base URLs stay on `localhost` because the page origin must match what the engine allows.
- **Ollama is on `11435`** for this stack; `11434` belongs to another project on this machine.
- **Never use `window.confirm`, `alert`, or `prompt`** in web code. A native modal blocks the browser harness and takes the 161-case campaign with it. Use antd `Popconfirm`.
- **Every new problem code must be added to the `ProblemType` union** in `apps/engine/src/common/problem.ts`. It is a closed union; a code not listed there does not compile.
- **Admin-only routes carry both** `@Roles('admin')` on the controller method **and** a `currentPrincipal().role !== 'admin'` check in the service. The service check is what unit tests pin and what protects non-HTTP callers; the decorator is what surfaces the restriction in OpenAPI. See `settings.controller.ts` for the pattern and its comment.
- **Ownership failures return 404, never 403.** A 403 leaks that the record exists.
- **Stage identity is the ULID, never the name.**
- **Commit messages carry no AI attribution or co-author trailer.**

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `packages/contracts/src/pipeline.ts` | Stage, Pipeline, UpdatePipeline schemas; `MAX_STAGES`; `DEFAULT_PIPELINE` |
| `packages/contracts/src/pipeline.test.ts` | Contract tests for the above |
| `packages/contracts/src/thread.ts` | Message schemas and `MessageRecord` |
| `packages/contracts/src/thread.test.ts` | Contract tests for the above |
| `apps/engine/src/pipeline/pipeline.service.ts` | Read/write the tenant pipeline; version conflict |
| `apps/engine/src/pipeline/pipeline.controller.ts` | `GET`/`PUT /settings/pipeline` |
| `apps/engine/src/pipeline/pipeline.module.ts` | Nest wiring |
| `apps/engine/src/pipeline/pipeline.service.test.ts` | Unit tests |
| `apps/engine/src/threads/threads.service.ts` | Post and list order messages |
| `apps/engine/src/threads/threads.controller.ts` | `POST`/`GET /orders/:id/messages` |
| `apps/engine/src/threads/threads.module.ts` | Nest wiring |
| `apps/engine/test/e2e/pipeline.e2e.test.ts` | Pipeline end-to-end |
| `apps/engine/test/e2e/threads.e2e.test.ts` | Messaging end-to-end |
| `apps/web/lib/api/pipeline.ts` | Pipeline client calls |
| `apps/web/lib/api/messages.ts` | Message client calls |
| `apps/web/components/stage-tracker.tsx` | Vertical tracker, rendered from a snapshot |
| `apps/web/components/stage-tracker.test.tsx` | Tracker unit tests |
| `apps/web/components/stage-thread.tsx` | One stage's messages + composer |
| `apps/web/components/stage-thread.test.tsx` | Thread unit tests |
| `apps/web/app/(admin)/admin/settings/stage-editor.tsx` | Sortable editor + live preview |
| `apps/web/app/(admin)/admin/settings/stage-editor.test.tsx` | Editor unit tests |
| `apps/web/e2e/journeys/order-stages.spec.ts` | The one data-driven browser journey |

**Modified:**

| File | Change |
|---|---|
| `packages/contracts/src/index.ts` | Export the two new modules |
| `packages/contracts/src/registry.ts` | Reserve the four new Order field names |
| `packages/contracts/src/responses.ts` | `OrderResponseSchema` gains four fields |
| `apps/engine/src/common/problem.ts` | Six new problem codes |
| `apps/engine/src/persistence/keys.ts` | `Message` entity, `messageSk`, `messagePrefix`, `PIPELINE_SK` |
| `apps/engine/src/orders/orders.service.ts` | Snapshot on create; `advance`; `cancel`; normalise on read |
| `apps/engine/src/orders/orders.controller.ts` | Two new routes |
| `apps/engine/src/orders/orders.module.ts` | Inject `PipelineService` |
| `apps/engine/src/app.module.ts` | Register the two new modules |
| `apps/engine/test/e2e/orders.e2e.test.ts` | Advance and cancel coverage |
| `apps/web/lib/api/orders.ts` | `advanceOrder`, `cancelOrder` |
| `apps/web/app/(shop)/orders/[id]/page.tsx` | Tracker, threads, cancel |
| `apps/web/app/(shop)/orders/page.tsx` | Stage name on each row |
| `apps/web/app/(admin)/admin/settings/page.tsx` | Mount the stage editor |

---

### Task 1: Pipeline contracts

**Files:**
- Create: `packages/contracts/src/pipeline.ts`
- Create: `packages/contracts/src/pipeline.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `UlidSchema` from `./common`.
- Produces: `MAX_STAGES: 12`, `StageSchema`, `Stage`, `PipelineSchema`, `Pipeline`, `StageInputSchema`, `UpdatePipelineSchema`, `UpdatePipeline`, `DEFAULT_PIPELINE: Pipeline`, `DEFAULT_STAGE_ID: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/contracts/src/pipeline.test.ts
import {
  DEFAULT_PIPELINE,
  MAX_STAGES,
  PipelineSchema,
  StageSchema,
  UpdatePipelineSchema,
} from './pipeline';

const stage = (over: Record<string, unknown> = {}) => ({
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'Packed',
  cancellable: false,
  messaging: false,
  ...over,
});

describe('StageSchema', () => {
  it('trims the name', () => {
    expect(StageSchema.parse(stage({ name: '  Packed  ' })).name).toBe('Packed');
  });

  it('rejects a whitespace-only name', () => {
    expect(() => StageSchema.parse(stage({ name: '   ' }))).toThrow();
  });

  it('rejects a name past the bound', () => {
    expect(() => StageSchema.parse(stage({ name: 'x'.repeat(61) }))).toThrow();
  });

  it('defaults both switches to false', () => {
    const parsed = StageSchema.parse({ id: stage().id, name: 'Packed' });
    expect(parsed).toMatchObject({ cancellable: false, messaging: false });
  });

  it('rejects an unknown key', () => {
    expect(() => StageSchema.parse(stage({ colour: 'red' }))).toThrow();
  });
});

describe('UpdatePipelineSchema', () => {
  const body = (stages: unknown[]) => ({ version: 0, stages });

  it('accepts a stage with no id, for a stage being added', () => {
    const parsed = UpdatePipelineSchema.parse(body([{ name: 'New' }]));
    expect(parsed.stages[0].id).toBeUndefined();
  });

  it('rejects an empty stage list', () => {
    expect(() => UpdatePipelineSchema.parse(body([]))).toThrow();
  });

  it(`rejects more than ${MAX_STAGES} stages`, () => {
    const many = Array.from({ length: MAX_STAGES + 1 }, (_, i) => ({ name: `S${i}` }));
    expect(() => UpdatePipelineSchema.parse(body(many))).toThrow();
  });

  it('rejects two stages sharing an id', () => {
    expect(() => UpdatePipelineSchema.parse(body([stage(), stage({ name: 'Other' })]))).toThrow(
      /duplicate/i,
    );
  });

  it('rejects two stages whose names differ only by case or padding', () => {
    expect(() =>
      UpdatePipelineSchema.parse(body([{ name: 'Packed' }, { name: '  packed ' }])),
    ).toThrow(/duplicate/i);
  });
});

describe('DEFAULT_PIPELINE', () => {
  it('is a valid pipeline of exactly one cancellable stage at version 0', () => {
    expect(PipelineSchema.parse(DEFAULT_PIPELINE)).toEqual(DEFAULT_PIPELINE);
    expect(DEFAULT_PIPELINE.version).toBe(0);
    expect(DEFAULT_PIPELINE.stages).toHaveLength(1);
    expect(DEFAULT_PIPELINE.stages[0]).toMatchObject({ cancellable: true, messaging: false });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `pnpm --filter @marketplace/contracts test -- pipeline`
Expected: FAIL — `Cannot find module './pipeline'`

- [ ] **Step 3: Write the contracts**

```ts
// packages/contracts/src/pipeline.ts
import { z } from 'zod';
import { UlidSchema } from './common';

/**
 * How many stages one shop may define. Bounded for the same reason
 * MAX_ORDER_LINE_ITEMS is: the list renders as a tracker on the buyer's order
 * page and is copied onto every order placed under it.
 */
export const MAX_STAGES = 12;

const StageNameSchema = z.string().trim().min(1).max(60);

export const StageSchema = z
  .object({
    // A stage's identity is this ULID, never its name -- a rename must not
    // orphan the stage's messages or the orders pinned to it.
    id: UlidSchema,
    name: StageNameSchema,
    cancellable: z.boolean().default(false),
    messaging: z.boolean().default(false),
  })
  .strict();
export type Stage = z.infer<typeof StageSchema>;

export const PipelineSchema = z
  .object({
    // 0 means "never configured" -- the built-in default. A real save starts at 1.
    version: z.number().int().nonnegative(),
    stages: z.array(StageSchema).min(1).max(MAX_STAGES),
  })
  .strict();
export type Pipeline = z.infer<typeof PipelineSchema>;

/** Absent `id` means "a stage being added"; the service mints the ULID. */
export const StageInputSchema = StageSchema.extend({ id: UlidSchema.optional() });
export type StageInput = z.infer<typeof StageInputSchema>;

const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Two stages labelled the same thing is bug #6 one layer up: the seller sees
 * two identical rows in the editor and the buyer two identical steps in the
 * tracker, with no way to tell them apart.
 */
function refuseDuplicates(
  value: { stages: StageInput[] },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  value.stages.forEach((stage, index) => {
    if (stage.id !== undefined) {
      if (ids.has(stage.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['stages', index, 'id'],
          message: `duplicate stage id ${stage.id}`,
        });
      }
      ids.add(stage.id);
    }
    const name = normalizeName(stage.name);
    if (names.has(name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['stages', index, 'name'],
        message: `duplicate stage name ${stage.name}`,
      });
    }
    names.add(name);
  });
}

export const UpdatePipelineSchema = z
  .object({
    // The version the editor loaded. The service conditions its write on it, so
    // two admins saving at once cannot silently clobber one another.
    version: z.number().int().nonnegative(),
    stages: z.array(StageInputSchema).min(1).max(MAX_STAGES),
  })
  .strict()
  .superRefine(refuseDuplicates);
export type UpdatePipeline = z.infer<typeof UpdatePipelineSchema>;

/** Crockford base32, so it satisfies UlidSchema. */
export const DEFAULT_STAGE_ID = '0'.repeat(26);

/**
 * What a shop that has never configured a pipeline has, and what an order
 * written before this feature existed normalises to on read. Absence is a
 * state, not an error -- the same treatment `getAnnouncement` gives a shop
 * that has never set an announcement.
 */
export const DEFAULT_PIPELINE: Pipeline = {
  version: 0,
  stages: [{ id: DEFAULT_STAGE_ID, name: 'Confirmed', cancellable: true, messaging: false }],
};
```

- [ ] **Step 4: Export it**

Add to `packages/contracts/src/index.ts`, after the `./flow` line:

```ts
export * from './pipeline';
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `pnpm --filter @marketplace/contracts test -- pipeline`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/pipeline.ts packages/contracts/src/pipeline.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): a shop's order stages are its own to name"
```

---

### Task 2: Reserve the new Order field names

Without this a tenant can add a dynamic attribute called `stages`, which is bug #6 — the tenant field shadowing a core one — with `refuseReservedFieldNames` already built to stop it.

**Files:**
- Modify: `packages/contracts/src/registry.ts:43` (the `ENTITY_FIELDS.Order` line)
- Modify: `packages/contracts/src/flow.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `reservedFieldNames('Order')` now contains `stages`, `currentStageId`, `pipelineVersion`, `stageEnteredAt`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/flow.test.ts -- add inside the existing describe block
it.each(['stages', 'currentStageId', 'pipelineVersion', 'stageEnteredAt'])(
  'refuses a tenant field that shadows the order stage field %s',
  (field) => {
    expect(() =>
      CreateFlowSchema.parse({
        targetEntity: 'Order',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    ).toThrow();
  },
);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @marketplace/contracts test -- flow`
Expected: FAIL — the parse succeeds, so `toThrow()` fails, for all four names.

- [ ] **Step 3: Reserve the names**

In `packages/contracts/src/registry.ts`, replace the `Order` line of `ENTITY_FIELDS`:

```ts
  Order: [
    'userId', 'status', 'totalAmountMinor', 'currency', 'items', 'shippingAddress',
    'stages', 'currentStageId', 'pipelineVersion', 'stageEnteredAt',
  ],
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @marketplace/contracts test -- flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/registry.ts packages/contracts/src/flow.test.ts
git commit -m "fix(contracts): a tenant field may not shadow an order's stage fields"
```

---

### Task 3: Order response carries its stage snapshot

Old orders have none of these attributes. They are filled on read rather than backfilled, so `OrderResponseSchema` can require them while every existing record still parses.

**Files:**
- Modify: `packages/contracts/src/responses.ts:67-81`
- Modify: `packages/contracts/src/responses.test.ts`
- Modify: `packages/contracts/src/order.ts`

**Interfaces:**
- Consumes: `StageSchema`, `Pipeline` from Task 1.
- Produces: `OrderResponse` with `pipelineVersion: number`, `stages: Stage[]`, `currentStageId: string`, `stageEnteredAt: string`. `OrderRecord` gains the same four as optional (`?`), because records written before this feature lack them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/responses.test.ts -- add
it('requires the stage snapshot on an order response', () => {
  const withoutStages = { ...validOrderResponse };
  delete (withoutStages as Record<string, unknown>).stages;
  expect(() => OrderResponseSchema.parse(withoutStages)).toThrow();
});

it('accepts an order carrying a multi-stage snapshot', () => {
  const parsed = OrderResponseSchema.parse({
    ...validOrderResponse,
    pipelineVersion: 3,
    stages: [
      { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Cut', cancellable: true, messaging: true },
      { id: '01ARZ3NDEKTSV4RRFFQ69G5FAW', name: 'Sealed', cancellable: false, messaging: false },
    ],
    currentStageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    stageEnteredAt: '2026-08-18T10:00:00.000Z',
  });
  expect(parsed.stages).toHaveLength(2);
});
```

Extend the file's existing order fixture with the four fields so the other tests keep passing.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @marketplace/contracts test -- responses`
Expected: FAIL — `.strict()` rejects `stages` as an unknown key.

- [ ] **Step 3: Add the fields**

In `packages/contracts/src/responses.ts`, inside `OrderResponseSchema`, after `createdAt`:

```ts
    // The stage list this order was placed under, copied at write time. A later
    // rename or reorder by the owner publishes a new pipeline version and never
    // touches this snapshot -- the same argument `unitPriceMinor` makes for price.
    pipelineVersion: z.number().int().nonnegative(),
    stages: z.array(StageSchema).min(1).max(MAX_STAGES),
    currentStageId: z.string(),
    stageEnteredAt: IsoDateTimeSchema,
```

Import `StageSchema` and `MAX_STAGES` from `./pipeline` at the top of the file.

In `packages/contracts/src/order.ts`, add to `OrderRecord`:

```ts
  // Optional on the stored record, required on the response: orders written
  // before stages existed have none of these, and `toResponse` fills them from
  // DEFAULT_PIPELINE rather than a migration backfilling the table.
  pipelineVersion?: number;
  stages?: Stage[];
  currentStageId?: string;
  stageEnteredAt?: string;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @marketplace/contracts test`
Expected: PASS, whole package.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): an order carries the stages it was placed under"
```

---

### Task 4: Problem codes and key helpers

**Files:**
- Modify: `apps/engine/src/common/problem.ts`
- Modify: `apps/engine/src/persistence/keys.ts`

**Interfaces:**
- Produces: problem codes `pipeline-version-conflict`, `stage-moved`, `order-at-final-stage`, `order-not-advanceable`, `order-not-cancellable`, `stage-not-messageable`, `order-not-messageable`. Key helpers `PIPELINE_SK`, `messageSk(orderId, id)`, `messagePrefix(orderId)`, and `'Message'` in `KeyedEntityType`/`SK_PREFIX`.

- [ ] **Step 1: Add the problem codes**

In `apps/engine/src/common/problem.ts`, extend the `ProblemType` union — it is closed, so anything missing here will not compile at its call site:

```ts
  | 'pipeline-version-conflict'
  | 'stage-moved'
  | 'order-at-final-stage'
  | 'order-not-advanceable'
  | 'order-not-cancellable'
  | 'stage-not-messageable'
  | 'order-not-messageable'
```

- [ ] **Step 2: Add the key helpers**

In `apps/engine/src/persistence/keys.ts`:

```ts
export type KeyedEntityType = 'Product' | 'Order' | 'Event' | 'Booking' | 'Flow' | 'Message';

export const SK_PREFIX: Record<KeyedEntityType, string> = {
  Product: 'PRODUCT#',
  Order: 'ORDER#',
  Event: 'EVENT#',
  Booking: 'BOOKING#',
  Flow: 'FLOW#',
  Message: 'MESSAGE#',
};

/** The tenant's order-stage pipeline. One record per tenant. */
export const PIPELINE_SK = settingsSk('pipeline');

/**
 * Messages sort under their order, and ULID ids sort chronologically, so one
 * `begins_with` query returns a whole order's conversation in order.
 */
export function messageSk(orderId: string, id: string): string {
  return `${SK_PREFIX.Message}${orderId}#${id}`;
}

export function messagePrefix(orderId: string): string {
  return `${SK_PREFIX.Message}${orderId}#`;
}
```

`PIPELINE_SK` must be declared after `settingsSk`.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @marketplace/engine typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/engine/src/common/problem.ts apps/engine/src/persistence/keys.ts
git commit -m "feat(engine): problem codes and keys for order stages"
```

---

### Task 5: PipelineService

**Files:**
- Create: `apps/engine/src/pipeline/pipeline.service.ts`
- Create: `apps/engine/src/pipeline/pipeline.service.test.ts`
- Create: `apps/engine/src/pipeline/pipeline.controller.ts`
- Create: `apps/engine/src/pipeline/pipeline.module.ts`
- Modify: `apps/engine/src/app.module.ts`

**Interfaces:**
- Consumes: `DynamoRepository` (`get`, `put`, `key`, `tableName`, `transactWrite`), `currentPrincipal`, `newId` from `../common/ids`, `PIPELINE_SK`, `DEFAULT_PIPELINE`, `UpdatePipeline`.
- Produces: `PipelineService.get(): Promise<Pipeline>` and `PipelineService.update(input: UpdatePipeline): Promise<Pipeline>`. Task 6 and Task 8 both call `get()`.

- [ ] **Step 1: Write the failing unit tests**

```ts
// apps/engine/src/pipeline/pipeline.service.test.ts
import { DEFAULT_PIPELINE } from '@marketplace/contracts';
import { PipelineService } from './pipeline.service';

// Follow the mocking style already used by settings.service.test.ts.
describe('PipelineService', () => {
  it('returns the built-in default when the tenant has never configured one', async () => {
    const repo = { get: jest.fn().mockResolvedValue(null) };
    const service = new PipelineService(repo as never);
    await expect(service.get()).resolves.toEqual(DEFAULT_PIPELINE);
  });

  it('refuses a non-admin', async () => {
    const repo = { get: jest.fn(), put: jest.fn() };
    const service = new PipelineService(repo as never);
    await withPrincipal({ role: 'buyer' }, async () => {
      await expect(service.update({ version: 0, stages: [{ name: 'One' }] })).rejects.toMatchObject(
        { problem: { status: 403 } },
      );
    });
  });

  it('mints an id for a new stage and keeps the id of an existing one', async () => {
    const existing = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const repo = { get: jest.fn(), put: jest.fn().mockResolvedValue(undefined) };
    const service = new PipelineService(repo as never);
    await withPrincipal({ role: 'admin' }, async () => {
      const saved = await service.update({
        version: 0,
        stages: [{ id: existing, name: 'Kept' }, { name: 'Added' }],
      });
      expect(saved.stages[0].id).toBe(existing);
      expect(saved.stages[1].id).toHaveLength(26);
      expect(saved.version).toBe(1);
    });
  });
});
```

`withPrincipal` is the existing test helper used by the other engine service unit tests; reuse it rather than writing a new one.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @marketplace/engine test -- pipeline.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the service**

```ts
// apps/engine/src/pipeline/pipeline.service.ts
import { Injectable } from '@nestjs/common';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DEFAULT_PIPELINE, Pipeline, Stage, UpdatePipeline } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { PIPELINE_SK } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';

@Injectable()
export class PipelineService {
  constructor(private readonly repo: DynamoRepository) {}

  /** Every signed-in user of the tenant may read it -- the storefront renders it. */
  async get(): Promise<Pipeline> {
    const found = await this.repo.get<Pipeline>(PIPELINE_SK);
    // Absence is a state, not an error: a shop that has never configured a
    // pipeline has one stage, and every order it has ever taken sits in it.
    return found ? { version: found.version, stages: found.stages } : DEFAULT_PIPELINE;
  }

  async update(input: UpdatePipeline): Promise<Pipeline> {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can set the order stages');
    }

    // A stage arriving without an id is one the owner just added; a stage that
    // brought its id keeps it, because its id is what pins existing orders and
    // addresses its messages.
    const stages: Stage[] = input.stages.map((stage) => ({
      id: stage.id ?? newId(),
      name: stage.name,
      cancellable: stage.cancellable,
      messaging: stage.messaging,
    }));
    const next: Pipeline = { version: input.version + 1, stages };

    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(PIPELINE_SK),
            UpdateExpression: 'SET #version = :next, #stages = :stages',
            // `attribute_not_exists` covers the first save, where there is no
            // record yet and the editor legitimately submits version 0.
            ConditionExpression:
              'attribute_not_exists(#version) OR #version = :expected',
            ExpressionAttributeNames: { '#version': 'version', '#stages': 'stages' },
            ExpressionAttributeValues: {
              ':next': next.version,
              ':stages': stages,
              ':expected': input.version,
            },
          },
        },
      ]);
    } catch (err) {
      // Two admins editing at once: one commits, the other must re-read rather
      // than silently clobbering the save it never saw.
      if (err instanceof ConditionalCheckFailedException || isCancelledForCondition(err)) {
        throw new ProblemException(
          'pipeline-version-conflict',
          409,
          'Order stages changed',
          'someone else saved the order stages while you were editing; reload and reapply',
          { expectedVersion: input.version },
        );
      }
      throw err;
    }

    return next;
  }
}
```

Add the small helper beneath it, reusing the existing transaction-error utilities:

```ts
import { failedTransactionIndexes } from '../common/transaction-errors';

const isCancelledForCondition = (err: unknown): boolean =>
  failedTransactionIndexes(err).includes(0);
```

- [ ] **Step 4: Write the controller and module**

```ts
// apps/engine/src/pipeline/pipeline.controller.ts
import { Controller, Get, Put } from '@nestjs/common';
import { Pipeline, UpdatePipeline, UpdatePipelineSchema } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { PipelineService } from './pipeline.service';

@Controller('settings')
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('pipeline')
  get(): Promise<Pipeline> {
    return this.pipeline.get();
  }

  // Declared here as well as checked in the service, matching the announcement
  // route: the service check is what the unit tests pin, the decorator is what
  // makes the restriction visible in the OpenAPI document.
  @Put('pipeline')
  @Roles('admin')
  update(@ZodBody(UpdatePipelineSchema) body: UpdatePipeline): Promise<Pipeline> {
    return this.pipeline.update(body);
  }
}
```

```ts
// apps/engine/src/pipeline/pipeline.module.ts
import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [PersistenceModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
```

Import the module name used by the other feature modules for persistence — copy the import list from `apps/engine/src/settings/settings.module.ts` if it differs. Register `PipelineModule` in `apps/engine/src/app.module.ts` alongside `SettingsModule`.

- [ ] **Step 5: Run and watch it pass**

Run: `pnpm --filter @marketplace/engine test -- pipeline.service`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src/pipeline apps/engine/src/app.module.ts
git commit -m "feat(engine): a shop owner sets the stages an order passes through"
```

---

### Task 6: An order is placed into its shop's stages

**Files:**
- Modify: `apps/engine/src/orders/orders.service.ts`
- Modify: `apps/engine/src/orders/orders.module.ts`

**Interfaces:**
- Consumes: `PipelineService.get()` from Task 5.
- Produces: `OrdersService.create` writes `pipelineVersion`, `stages`, `currentStageId`, `stageEnteredAt`. `toResponse` fills those four from `DEFAULT_PIPELINE` when a stored record lacks them.

- [ ] **Step 1: Write the failing e2e test**

```ts
// apps/engine/test/e2e/orders.e2e.test.ts -- add
it('places a new order in the shop’s first stage', async () => {
  const product = await createProduct(headers, { stock: 5 });
  const res = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      currency: 'INR',
      shippingAddress: { line1: '1 Road' },
    }),
  });
  expect(res.status).toBe(201);
  const order = await res.json();
  expect(order.stages.length).toBeGreaterThanOrEqual(1);
  expect(order.currentStageId).toBe(order.stages[0].id);
  expect(order.stageEnteredAt).toBe(order.createdAt);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: FAIL — `order.stages` is `undefined`.

- [ ] **Step 3: Snapshot the pipeline onto the order**

Inject `PipelineService` into `OrdersService`'s constructor and add `PipelineModule` to `OrdersModule`'s imports.

In `create`, after `const attributes = await this.registry.validate(...)`:

```ts
    // Copied onto the order now, at write time, exactly as `unitPriceMinor` is:
    // a later rename or reorder by the owner publishes a new version and must
    // never rewrite the lifecycle an existing order is already walking.
    const pipeline = await this.pipeline.get();
```

Add to `record`, after `createdAt`:

```ts
      pipelineVersion: pipeline.version,
      stages: pipeline.stages,
      currentStageId: pipeline.stages[0].id,
      stageEnteredAt: createdAt,
```

Append one item to `transactItems`, **after** the order `Put` — `explainFailure` maps a failed index back to a line item on the assumption that items `0..n-1` are the stock updates, so nothing may be inserted before them:

```ts
      {
        // The pipeline was read a moment ago and is not otherwise pinned. If the
        // owner saves a new one between that read and this commit, the order
        // would be stamped with a lifecycle that is already superseded; fail the
        // transaction instead and let the buyer retry against the new pipeline.
        // Deliberately last: `explainFailure` maps indexes 0..n-1 to line items.
        ConditionCheck: {
          TableName: this.repo.tableName,
          Key: this.repo.key(PIPELINE_SK),
          ConditionExpression:
            pipeline.version === 0
              ? 'attribute_not_exists(#version)'
              : '#version = :expectedVersion',
          ExpressionAttributeNames: { '#version': 'version' },
          ExpressionAttributeValues:
            pipeline.version === 0 ? undefined : { ':expectedVersion': pipeline.version },
        },
      },
```

- [ ] **Step 4: Normalise old orders on read**

Replace `toResponse` in the same file:

```ts
function toResponse(record: OrderRecord): OrderResponse {
  const { PK: _pk, SK: _sk, GSI1PK: _gsi1pk, GSI1SK: _gsi1sk, ...rest } = record;
  // Orders written before stages existed carry none of these attributes. They
  // are filled here rather than backfilled into the table, so the response
  // schema can require them without a migration and without a dual-shape type.
  return {
    ...rest,
    pipelineVersion: rest.pipelineVersion ?? DEFAULT_PIPELINE.version,
    stages: rest.stages ?? DEFAULT_PIPELINE.stages,
    currentStageId: rest.currentStageId ?? DEFAULT_PIPELINE.stages[0].id,
    stageEnteredAt: rest.stageEnteredAt ?? rest.createdAt,
  };
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: PASS, including every pre-existing order test.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src/orders
git commit -m "feat(engine): an order is placed into its shop's first stage"
```

---

### Task 7: Advancing an order

**Files:**
- Modify: `apps/engine/src/orders/orders.service.ts`
- Modify: `apps/engine/src/orders/orders.controller.ts`
- Modify: `apps/engine/test/e2e/orders.e2e.test.ts`

**Interfaces:**
- Consumes: the snapshot fields from Task 6.
- Produces: `OrdersService.advance(id: string, currentStageId: string): Promise<OrderResponse>`; route `POST /orders/:id/advance` with body `{ currentStageId }`; contract `AdvanceOrderSchema` exported from `packages/contracts/src/order.ts`.

- [ ] **Step 1: Add the request contract**

```ts
// packages/contracts/src/order.ts
export const AdvanceOrderSchema = z.object({ currentStageId: z.string() }).strict();
export type AdvanceOrder = z.infer<typeof AdvanceOrderSchema>;
```

- [ ] **Step 2: Write the failing e2e tests**

```ts
// apps/engine/test/e2e/orders.e2e.test.ts -- add
async function setStages(adminHeaders: Record<string, string>, stages: unknown[], version: number) {
  const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
    method: 'PUT',
    headers: adminHeaders,
    body: JSON.stringify({ version, stages }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number; stages: { id: string; name: string }[] };
}

it('walks an order along the stages the owner defined', async () => {
  const pipeline = await setStages(
    adminHeaders,
    [{ name: 'Mount cut', cancellable: true }, { name: 'Glazed' }],
    (await (await fetch(`${baseUrl}/api/v1/settings/pipeline`, { headers })).json()).version,
  );
  const product = await createProduct(adminHeaders, { stock: 3 });
  const order = await placeOrder(headers, product.id, 1);

  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/advance`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ currentStageId: order.currentStageId }),
  });
  expect(res.status).toBe(200);
  expect((await res.json()).currentStageId).toBe(pipeline.stages[1].id);
});

it('refuses to advance past the last stage', async () => {
  // ...advance to the final stage first, then:
  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/advance`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ currentStageId: finalStageId }),
  });
  expect(res.status).toBe(409);
  expect((await res.json()).type).toContain('order-at-final-stage');
});

it('refuses an advance from a stage the order has already left', async () => {
  const stale = order.currentStageId;
  await advance(order.id, stale);
  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/advance`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ currentStageId: stale }),
  });
  expect(res.status).toBe(409);
  expect((await res.json()).type).toContain('stage-moved');
});

it('refuses an advance from a buyer', async () => {
  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/advance`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ currentStageId: order.currentStageId }),
  });
  expect(res.status).toBe(403);
});
```

Add `placeOrder` and `advance` as local helpers beside the existing `createProduct`, each asserting its status before returning, per the file's standing rule about guarding destructures.

- [ ] **Step 3: Run and watch them fail**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 4: Implement `advance`**

```ts
  async advance(id: string, expectedStageId: string): Promise<OrderResponse> {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, 'Only an admin can advance an order');
    }
    const order = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!order) throw new ProblemException('not-found', 404, 'Order not found');

    const current = toResponse(order);
    if (current.status !== 'confirmed') {
      throw new ProblemException(
        'order-not-advanceable',
        409,
        'Order is not advanceable',
        `order ${id} is ${current.status}`,
      );
    }

    const index = current.stages.findIndex((s) => s.id === current.currentStageId);
    const next = current.stages[index + 1];
    if (!next) {
      // A shop that has never configured a pipeline has exactly one stage, which
      // is therefore also its last: there is nowhere to advance to, and that is
      // correct rather than a defect.
      throw new ProblemException(
        'order-at-final-stage',
        409,
        'Order is at its final stage',
        `${current.stages[index].name} is the last stage this order was placed under`,
      );
    }

    const now = new Date().toISOString();
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Order', id)),
            UpdateExpression: 'SET #currentStageId = :next, #stageEnteredAt = :now',
            // Conditioned rather than read-then-written, so two sellers clicking
            // at the same moment cannot skip a stage between them -- the same
            // reasoning as `#stock >= :qty` in `create`.
            ConditionExpression: '#currentStageId = :expected AND #status = :confirmed',
            ExpressionAttributeNames: {
              '#currentStageId': 'currentStageId',
              '#stageEnteredAt': 'stageEnteredAt',
              '#status': 'status',
            },
            ExpressionAttributeValues: {
              ':next': next.id,
              ':now': now,
              ':expected': expectedStageId,
              ':confirmed': 'confirmed',
            },
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).includes(0)) {
        throw new ProblemException(
          'stage-moved',
          409,
          'Order stage moved',
          'this order left that stage before your change was applied; reload it',
          { expectedStageId },
        );
      }
      throw err;
    }

    return { ...current, currentStageId: next.id, stageEnteredAt: now };
  }
```

Add the route:

```ts
  @Post(':id/advance')
  @Roles('admin')
  advance(
    @Param('id') id: string,
    @ZodBody(AdvanceOrderSchema) body: AdvanceOrder,
  ): Promise<OrderResponse> {
    return this.orders.advance(id, body.currentStageId);
  }
```

- [ ] **Step 5: Run and watch them pass**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src/orders packages/contracts/src/order.ts apps/engine/test/e2e/orders.e2e.test.ts
git commit -m "feat(engine): a seller walks an order along its stages"
```

---

### Task 8: Cancelling an order restores its stock

**Files:**
- Modify: `apps/engine/src/orders/orders.service.ts`
- Modify: `apps/engine/src/orders/orders.controller.ts`
- Modify: `apps/engine/test/e2e/orders.e2e.test.ts`

**Interfaces:**
- Consumes: `advance` from Task 7 (the race test uses it).
- Produces: `OrdersService.cancel(id: string): Promise<OrderResponse>`; route `POST /orders/:id/cancel`, no body.

- [ ] **Step 1: Write the failing e2e tests**

```ts
it('restores stock for every line item when the buyer cancels', async () => {
  const a = await createProduct(adminHeaders, { stock: 5 });
  const b = await createProduct(adminHeaders, { stock: 9 });
  const order = await placeOrderItems(headers, [
    { productId: a.id, quantity: 2 },
    { productId: b.id, quantity: 3 },
  ]);

  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, {
    method: 'POST', headers,
  });
  expect(res.status).toBe(200);
  expect((await res.json()).status).toBe('cancelled');
  await expect(stockOf(a.id)).resolves.toBe(5);
  await expect(stockOf(b.id)).resolves.toBe(9);
});

it('refuses a second cancel and leaves stock alone', async () => {
  const product = await createProduct(adminHeaders, { stock: 4 });
  const order = await placeOrder(headers, product.id, 1);
  await cancel(order.id);

  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, {
    method: 'POST', headers,
  });
  expect(res.status).toBe(409);
  expect((await res.json()).type).toContain('order-not-cancellable');
  await expect(stockOf(product.id)).resolves.toBe(4);
});

it('refuses a cancel once the order reaches a stage the owner did not mark cancellable', async () => {
  await setStages(adminHeaders, [{ name: 'Packing', cancellable: true }, { name: 'Gone' }], version);
  const product = await createProduct(adminHeaders, { stock: 4 });
  const order = await placeOrder(headers, product.id, 1);
  await advance(order.id, order.currentStageId);

  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, {
    method: 'POST', headers,
  });
  expect(res.status).toBe(409);
  expect((await res.json()).type).toContain('order-not-cancellable');
  await expect(stockOf(product.id)).resolves.toBe(3);
});

it('hides another buyer’s order behind a 404', async () => {
  const other = await authHeaders('tenant_a', 'bob@example.com');
  const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, {
    method: 'POST', headers: other,
  });
  expect(res.status).toBe(404);
});

it('restores stock exactly once when two cancels race', async () => {
  const product = await createProduct(adminHeaders, { stock: 6 });
  const order = await placeOrder(headers, product.id, 2);

  const [one, two] = await Promise.all([
    fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, { method: 'POST', headers }),
    fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, { method: 'POST', headers }),
  ]);

  // Asserted on the resulting stock, not on the error class: orders.service.ts
  // documents that DynamoDB Local surfaces ConditionalCheckFailed where a real
  // table gives TransactionConflict, so the code is not stable across
  // environments but the invariant is.
  expect([one.status, two.status].sort()).toEqual([200, 409]);
  await expect(stockOf(product.id)).resolves.toBe(6);
});

it('has exactly one winner when a cancel races the seller advancing', async () => {
  // Stage one is cancellable, stage two is not: whoever loses this race must
  // lose completely. If both were applied the buyer would have cancelled goods
  // already dispatched, and the stock would come back for items that left.
  await setStages(adminHeaders, [
    { name: 'On the bench', cancellable: true },
    { name: 'Dispatched' },
  ], version);
  const product = await createProduct(adminHeaders, { stock: 6 });
  const order = await placeOrder(headers, product.id, 2);

  const [cancelled, advanced] = await Promise.all([
    fetch(`${baseUrl}/api/v1/orders/${order.id}/cancel`, { method: 'POST', headers }),
    fetch(`${baseUrl}/api/v1/orders/${order.id}/advance`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ currentStageId: order.currentStageId }),
    }),
  ]);

  const final = await getOrder(headers, order.id);
  if (cancelled.status === 200) {
    expect(advanced.status).toBe(409);
    expect(final.status).toBe('cancelled');
    expect(final.currentStageId).toBe(order.currentStageId);   // stopped where it died
    await expect(stockOf(product.id)).resolves.toBe(6);
  } else {
    expect(advanced.status).toBe(200);
    expect(final.status).toBe('confirmed');
    expect(final.currentStageId).not.toBe(order.currentStageId);
    await expect(stockOf(product.id)).resolves.toBe(4);        // stock stayed out
  }
});
```

`stockOf(id)` is a local helper doing `GET /products/:id` and returning `stock`, asserting 200 first.

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement `cancel`**

```ts
  async cancel(id: string): Promise<OrderResponse> {
    // Ownership is checked exactly as `get` does, and reported the same way: a
    // 403 here would confirm the order exists to somebody not allowed to see it.
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!found || found.userId !== currentPrincipal().userId) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    const current = toResponse(found);

    const stage = current.stages.find((s) => s.id === current.currentStageId);
    if (current.status !== 'confirmed' || !stage?.cancellable) {
      throw new ProblemException(
        'order-not-cancellable',
        409,
        'Order cannot be cancelled',
        current.status !== 'confirmed'
          ? `order ${id} is already ${current.status}`
          : `this shop does not allow cancelling at ${stage?.name ?? 'this stage'}`,
        { stageId: current.currentStageId },
      );
    }

    const transactItems = [
      ...current.items.map((item) => ({
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Product', item.productId)),
          UpdateExpression: 'SET #stock = #stock + :qty',
          // No price condition on the way back: `create` conditions on price
          // because it is charging money, and returning stock does not care what
          // the product costs now. No upper-bound check either -- StockSchema's
          // cap is an input bound, and conditioning on it would fail a buyer's
          // cancel for a reason they cannot fix.
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#stock': 'stock' },
          ExpressionAttributeValues: { ':qty': item.quantity },
        },
      })),
      {
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Order', id)),
          UpdateExpression: 'SET #status = :cancelled',
          // The status condition is what makes a double cancel impossible and
          // the stock restore exactly-once. The stage condition is what stops a
          // buyer cancelling goods the seller dispatched in the gap between
          // their page rendering and their click.
          ConditionExpression: '#status = :confirmed AND #currentStageId = :stage',
          ExpressionAttributeNames: { '#status': 'status', '#currentStageId': 'currentStageId' },
          ExpressionAttributeValues: {
            ':cancelled': 'cancelled',
            ':confirmed': 'confirmed',
            ':stage': current.currentStageId,
          },
        },
      },
    ];

    try {
      await this.repo.transactWrite(transactItems);
    } catch (err) {
      await this.explainCancelFailure(err, current);
      throw err;
    }

    // The order keeps its stage, so the buyer's tracker can say where it stopped
    // rather than only that it stopped.
    return { ...current, status: 'cancelled' };
  }

  private async explainCancelFailure(err: unknown, order: OrderResponse): Promise<never | void> {
    const failed = failedTransactionIndexes(err);

    const productIndex = failed.find((i) => i < order.items.length);
    if (productIndex !== undefined) {
      throw new ProblemException(
        'not-found',
        404,
        'Product no longer exists',
        `product ${order.items[productIndex].productId} was removed, so its stock cannot be restored`,
        { productId: order.items[productIndex].productId },
      );
    }

    if (failed.includes(order.items.length)) {
      // The order item's condition combines status and stage with AND, so a
      // cancellation alone does not say which failed. Re-read to tell them apart:
      // a stage that moved is recoverable by reloading, an already-cancelled
      // order is not.
      const now = await this.repo.get<OrderRecord>(entitySk('Order', order.id));
      if (now && now.status === 'confirmed') {
        throw new ProblemException(
          'stage-moved',
          409,
          'Order stage moved',
          'this order moved to another stage before your cancellation was applied; reload it',
          { stageId: order.currentStageId },
        );
      }
      throw new ProblemException(
        'order-not-cancellable',
        409,
        'Order cannot be cancelled',
        `order ${order.id} is already cancelled`,
      );
    }

    const conflict = conflictedTransactionIndexes(err).find((i) => i <= order.items.length);
    if (conflict !== undefined) {
      throw new ProblemException(
        'transaction-conflict',
        409,
        'Concurrent write conflict',
        'this order was updated by another request at the same moment; retry',
      );
    }
  }
```

Add the route — **no `IdempotencyInterceptor`**: the status condition already makes cancel single-shot, and a replayed 200 would tell a buyer a second cancel succeeded.

```ts
  @Post(':id/cancel')
  cancel(@Param('id') id: string): Promise<OrderResponse> {
    return this.orders.cancel(id);
  }
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @marketplace/engine test:e2e -- orders`
Expected: PASS, including the race test.

- [ ] **Step 5: Commit**

```bash
git add apps/engine/src/orders apps/engine/test/e2e/orders.e2e.test.ts
git commit -m "feat(engine): a buyer cancels while the shop still allows it, and the stock comes back"
```

---

### Task 9: Pipeline end-to-end, including the pinning guarantee

**Files:**
- Create: `apps/engine/test/e2e/pipeline.e2e.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–8.
- Produces: no source; this task is the proof that pinning works.

- [ ] **Step 1: Write the tests**

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

describe('order stage pipeline', () => {
  let buyer: Record<string, string>;
  let admin: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    buyer = await authHeaders('tenant_pipeline', 'buyer@example.com');
    admin = await authHeaders('tenant_pipeline', 'admin@example.com', 'admin');
  });

  it('gives a shop that never configured one a single cancellable stage', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, { headers: buyer });
    expect(res.status).toBe(200);
    const pipeline = await res.json();
    expect(pipeline.version).toBe(0);
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0].cancellable).toBe(true);
  });

  it('refuses a save from a buyer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ version: 0, stages: [{ name: 'Mine' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('mints ids for new stages and bumps the version', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({
        version: 0,
        stages: [{ name: 'Order received', cancellable: true }, { name: 'Collected' }],
      }),
    });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.version).toBe(1);
    expect(saved.stages.map((s: { id: string }) => s.id)).toHaveLength(2);
  });

  it('refuses a save from a stale version', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({ version: 0, stages: [{ name: 'Late' }] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).type).toContain('pipeline-version-conflict');
  });

  it('leaves an order in flight on the stages it was placed under', async () => {
    const order = await placeOrder(buyer, admin);          // placed at version 1
    const before = order.stages.map((s: { name: string }) => s.name);

    await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: admin,
      body: JSON.stringify({
        version: 1,
        stages: [{ name: 'Renamed entirely' }, { name: 'And again' }],
      }),
    });

    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}`, { headers: buyer });
    expect(res.status).toBe(200);
    const after = await res.json();
    // The whole pinning decision, in one assertion.
    expect(after.stages.map((s: { name: string }) => s.name)).toEqual(before);
    expect(after.pipelineVersion).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm every one passes**

Run: `pnpm --filter @marketplace/engine test:e2e -- pipeline`
Expected: PASS, 5 tests. If the pinning test fails, Task 6's snapshot is being re-read rather than copied — fix that, not the test.

- [ ] **Step 3: Commit**

```bash
git add apps/engine/test/e2e/pipeline.e2e.test.ts
git commit -m "test(engine): an order in flight keeps the stages it was placed under"
```

---

### Task 10: Message contracts and the threads service

**Files:**
- Create: `packages/contracts/src/thread.ts`
- Create: `packages/contracts/src/thread.test.ts`
- Create: `apps/engine/src/threads/threads.service.ts`
- Create: `apps/engine/src/threads/threads.controller.ts`
- Create: `apps/engine/src/threads/threads.module.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/engine/src/app.module.ts`

**Interfaces:**
- Consumes: `messageSk`, `messagePrefix` (Task 4); `OrdersService.get` semantics.
- Produces: `CreateMessageSchema`, `MessageResponseSchema`, `MessageResponse`, `MessageRecord`; `ThreadsService.post(orderId, body)` and `ThreadsService.list(orderId, limit, cursor)`; routes `POST`/`GET /orders/:id/messages`.

- [ ] **Step 1: Write the failing contract tests**

```ts
// packages/contracts/src/thread.test.ts
import { CreateMessageSchema } from './thread';

describe('CreateMessageSchema', () => {
  it('trims the body', () => {
    expect(CreateMessageSchema.parse({ body: '  hello  ' }).body).toBe('hello');
  });

  it('rejects a whitespace-only body', () => {
    expect(() => CreateMessageSchema.parse({ body: '   ' })).toThrow();
  });

  it('rejects a body past the bound', () => {
    expect(() => CreateMessageSchema.parse({ body: 'x'.repeat(2001) })).toThrow();
  });

  it('rejects a client-chosen stage', () => {
    expect(() => CreateMessageSchema.parse({ body: 'hi', stageId: 'anything' })).toThrow();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @marketplace/contracts test -- thread`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the contracts**

```ts
// packages/contracts/src/thread.ts
import { z } from 'zod';
import { IsoDateTimeSchema, UlidSchema } from './common';

export const MAX_MESSAGE_LENGTH = 2000;

/**
 * `.strict()` is what keeps the stage server-chosen: a client cannot name the
 * stage its message lands in, which is what makes "the thread closes when the
 * order advances" a property of the system rather than a rule someone enforces.
 */
export const CreateMessageSchema = z
  .object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) })
  .strict();
export type CreateMessage = z.infer<typeof CreateMessageSchema>;

export const MessageAuthorRoleSchema = z.enum(['buyer', 'seller']);
export type MessageAuthorRole = z.infer<typeof MessageAuthorRoleSchema>;

export const MessageResponseSchema = z
  .object({
    entityType: z.literal('Message'),
    id: UlidSchema,
    orderId: UlidSchema,
    stageId: z.string(),
    authorUserId: z.string(),
    authorRole: MessageAuthorRoleSchema,
    body: z.string(),
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export interface MessageRecord extends MessageResponse {
  PK: string;
  SK: string;
}
```

Export from `packages/contracts/src/index.ts`:

```ts
export * from './thread';
```

- [ ] **Step 4: Write the service**

```ts
// apps/engine/src/threads/threads.service.ts
import { Injectable } from '@nestjs/common';
import {
  CreateMessage,
  MessageRecord,
  MessageResponse,
  OrderRecord,
  Page,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { entitySk, messagePrefix, messageSk } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class ThreadsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly orders: OrdersService,
  ) {}

  /**
   * The buyer who placed the order, or any admin of the tenant. Anybody else is
   * told the order does not exist, matching `OrdersService.get`.
   */
  private async participantOrder(orderId: string): Promise<OrderRecord> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', orderId));
    const principal = currentPrincipal();
    if (!found || (found.userId !== principal.userId && principal.role !== 'admin')) {
      throw new ProblemException('not-found', 404, 'Order not found');
    }
    return found;
  }

  async post(orderId: string, input: CreateMessage): Promise<MessageResponse> {
    const record = await this.participantOrder(orderId);
    const order = this.orders.toResponsePublic(record);

    if (order.status !== 'confirmed') {
      throw new ProblemException(
        'order-not-messageable',
        409,
        'Order is closed to messages',
        `order ${orderId} is ${order.status}`,
      );
    }

    const stage = order.stages.find((s) => s.id === order.currentStageId);
    if (!stage?.messaging) {
      throw new ProblemException(
        'stage-not-messageable',
        409,
        'This stage has no message thread',
        `the shop did not enable messages at ${stage?.name ?? 'this stage'}`,
        { stageId: order.currentStageId },
      );
    }

    const principal = currentPrincipal();
    const id = newId();
    const message: MessageResponse = {
      entityType: 'Message',
      id,
      orderId,
      // Stamped from the order the server just read, never from the request: a
      // past stage cannot be addressed, so a closed thread cannot be written to.
      stageId: order.currentStageId,
      authorUserId: principal.userId,
      // Copied at write time rather than resolved at read time, on the same
      // argument as `unitPriceMinor`: a role can change, and a conversation
      // should show who somebody was when they wrote it.
      authorRole: principal.userId === order.userId ? 'buyer' : 'seller',
      body: input.body,
      createdAt: new Date().toISOString(),
    };

    await this.repo.put(messageSk(orderId, id), message);
    return message;
  }

  async list(orderId: string, limit: number, cursor: string | null): Promise<Page<MessageResponse>> {
    await this.participantOrder(orderId);
    const page = await this.repo.queryPrefix<MessageRecord>(messagePrefix(orderId), {
      limit,
      cursor,
    });
    return {
      items: page.items.map(({ PK: _pk, SK: _sk, ...rest }) => rest),
      nextCursor: page.nextCursor,
    };
  }
}
```

`toResponsePublic` is a thin public wrapper `OrdersService` must expose over its private `toResponse`, so the threads service reads an order through the same normalisation (old orders, default pipeline) rather than duplicating it. Add it to `OrdersService`:

```ts
  /** Exposed for ThreadsService: one normalisation of a stored order, not two. */
  toResponsePublic(record: OrderRecord): OrderResponse {
    return toResponse(record);
  }
```

- [ ] **Step 5: Write the controller and module**

```ts
// apps/engine/src/threads/threads.controller.ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import {
  CreateMessage,
  CreateMessageSchema,
  MessageResponse,
  Page,
} from '@marketplace/contracts';
import { ZodBody, ZodQuery } from '../common/zod-validation.pipe';
import { ListQuery, ListQuerySchema } from '../common/list-query.schema';
import { ThreadsService } from './threads.service';

@Controller('orders')
export class ThreadsController {
  constructor(private readonly threads: ThreadsService) {}

  @Post(':id/messages')
  post(
    @Param('id') id: string,
    @ZodBody(CreateMessageSchema) body: CreateMessage,
  ): Promise<MessageResponse> {
    return this.threads.post(id, body);
  }

  @Get(':id/messages')
  list(
    @Param('id') id: string,
    @ZodQuery(ListQuerySchema) query: ListQuery,
  ): Promise<Page<MessageResponse>> {
    return this.threads.list(id, query.limit, query.cursor ?? null);
  }
}
```

`threads.module.ts` imports `PersistenceModule` and `OrdersModule`, declares `ThreadsController`, provides `ThreadsService`. `OrdersModule` must export `OrdersService`. Register `ThreadsModule` in `app.module.ts`.

- [ ] **Step 6: Run the contract tests and typecheck**

Run: `pnpm --filter @marketplace/contracts test -- thread` — PASS, 4 tests.
Run: `pnpm --filter @marketplace/engine typecheck` — clean.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/thread.ts packages/contracts/src/thread.test.ts packages/contracts/src/index.ts apps/engine/src/threads apps/engine/src/orders apps/engine/src/app.module.ts
git commit -m "feat(engine): a stage can carry a conversation between buyer and seller"
```

---

### Task 11: Messaging end-to-end

**Files:**
- Create: `apps/engine/test/e2e/threads.e2e.test.ts`

**Interfaces:**
- Consumes: Task 10.

- [ ] **Step 1: Write the tests**

```ts
describe('order stage threads', () => {
  // Shop with two messaging stages, so advancing can be observed to close one.
  beforeAll(async () => {
    await waitForHealthy();
    buyer = await authHeaders('tenant_threads', 'buyer@example.com');
    admin = await authHeaders('tenant_threads', 'admin@example.com', 'admin');
    pipeline = await setStages(admin, [
      { name: 'Awaiting artwork', cancellable: true, messaging: true },
      { name: 'Mount cut', messaging: true },
      { name: 'Collected' },
    ], 0);
  });

  it('stamps a message with the stage the order is in', async () => {
    const order = await placeOrder(buyer, admin);
    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      method: 'POST', headers: buyer, body: JSON.stringify({ body: 'Sending the print today' }),
    });
    expect(res.status).toBe(201);
    const message = await res.json();
    expect(message.stageId).toBe(order.currentStageId);
    expect(message.authorRole).toBe('buyer');
  });

  it('records the seller as the seller', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      method: 'POST', headers: admin, body: JSON.stringify({ body: 'Received, thank you' }),
    });
    expect(res.status).toBe(201);
    expect((await res.json()).authorRole).toBe('seller');
  });

  it('lands a message in the new stage once the order advances, leaving the old thread as history', async () => {
    const order = await placeOrder(buyer, admin);
    const first = await postMessage(buyer, order.id, 'in stage one');
    await advance(admin, order.id, order.currentStageId);
    const second = await postMessage(buyer, order.id, 'in stage two');

    expect(second.stageId).not.toBe(first.stageId);

    const listed = await (await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      headers: buyer,
    })).json();
    // Both are readable; only the current stage is writable, and that is
    // enforced by the server choosing the stage, not by the client asking.
    expect(listed.items).toHaveLength(2);
  });

  it('refuses a message in a stage the shop left unmessageable', async () => {
    const order = await placeOrder(buyer, admin);
    await advance(admin, order.id, order.currentStageId);      // to Mount cut
    const cut = (await getOrder(buyer, order.id)).currentStageId;
    await advance(admin, order.id, cut);                        // to Collected
    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      method: 'POST', headers: buyer, body: JSON.stringify({ body: 'hello?' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).type).toContain('stage-not-messageable');
  });

  it('refuses a message on a cancelled order', async () => {
    const order = await placeOrder(buyer, admin);
    await cancel(buyer, order.id);
    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      method: 'POST', headers: buyer, body: JSON.stringify({ body: 'still there?' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).type).toContain('order-not-messageable');
  });

  it('hides another buyer’s thread behind a 404', async () => {
    const other = await authHeaders('tenant_threads', 'mallory@example.com');
    const res = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, { headers: other });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and confirm they pass**

Run: `pnpm --filter @marketplace/engine test:e2e -- threads`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add apps/engine/test/e2e/threads.e2e.test.ts
git commit -m "test(engine): a stage's thread opens and closes with the order"
```

---

### Task 12: A tighter rate-limit bucket for messages

The limiter from `22804ba` is `@nestjs/throttler`, configured by `ThrottlerModule.forRootAsync` in `app.module.ts` and enforced by `ProblemThrottlerGuard` (`apps/engine/src/common/throttler.ts`), registered as an `APP_GUARD` in `AuthModule` so it runs **before** the JWT guard. Do not add a second limiter — override the bucket on the one route.

**Files:**
- Modify: `apps/engine/src/threads/threads.controller.ts`
- Modify: `apps/engine/test/e2e/threads.e2e.test.ts`

**Interfaces:**
- Consumes: the existing `ProblemThrottlerGuard`.
- Produces: `MESSAGE_RATE_LIMIT` and `MESSAGE_RATE_TTL_MS` exported from `threads.controller.ts`, and a `POST /orders/:id/messages` limited to them.

- [ ] **Step 1: Write the failing test**

Add to `apps/engine/test/e2e/threads.e2e.test.ts`:

```ts
// Kept in step with the decorator on the route. Imported rather than repeated so
// the test cannot quietly drift from the limit it is asserting.
import { MESSAGE_RATE_LIMIT } from '../../src/threads/threads.controller';

it('limits message posting more tightly than the default bucket', async () => {
  const order = await placeOrder(buyer, admin);
  const burst = await Promise.all(
    Array.from({ length: MESSAGE_RATE_LIMIT + 5 }, () =>
      fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
        method: 'POST', headers: buyer, body: JSON.stringify({ body: 'spam' }),
      }),
    ),
  );
  expect(burst.some((r) => r.status === 429)).toBe(true);
  // The limiter must answer in the project's problem format, not throttler's default.
  const limited = burst.find((r) => r.status === 429)!;
  expect((await limited.json()).type).toContain('too-many-requests');
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @marketplace/engine test:e2e -- threads`
Expected: FAIL — no 429; every request is accepted under the default bucket.

- [ ] **Step 3: Add the bucket**

In `apps/engine/src/threads/threads.controller.ts`:

```ts
import { Throttle } from '@nestjs/throttler';

/**
 * A message POST is a cheaper spam vector than anything else exposed: it costs
 * one small write and no transaction, and a buyer legitimately sends a handful
 * per order, not dozens per minute.
 */
export const MESSAGE_RATE_LIMIT = 10;
export const MESSAGE_RATE_TTL_MS = 60_000;
```

and on the post route, above `@Post(':id/messages')`:

```ts
  @Throttle({ default: { limit: MESSAGE_RATE_LIMIT, ttl: MESSAGE_RATE_TTL_MS } })
```

- [ ] **Step 4: Run and watch it pass**

Run: `pnpm --filter @marketplace/engine test:e2e -- threads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/engine/src apps/engine/test/e2e/threads.e2e.test.ts
git commit -m "feat(engine): messages get their own rate-limit bucket"
```

---

### Task 13: Web API client

**Files:**
- Create: `apps/web/lib/api/pipeline.ts`
- Create: `apps/web/lib/api/messages.ts`
- Modify: `apps/web/lib/api/orders.ts`

**Interfaces:**
- Consumes: `request` from `./http`; the contracts from Tasks 1, 3, 7, 10.
- Produces: `getPipeline()`, `savePipeline(body)`, `advanceOrder(id, currentStageId)`, `cancelOrder(id)`, `listMessages(id, limit, cursor)`, `postMessage(id, body)`.

- [ ] **Step 1: Write the client functions**

```ts
// apps/web/lib/api/pipeline.ts
import { PipelineSchema, type UpdatePipeline } from '@marketplace/contracts';
import { request } from './http';

export const getPipeline = () => request('/settings/pipeline', { schema: PipelineSchema });

export const savePipeline = (body: UpdatePipeline) =>
  request('/settings/pipeline', { method: 'PUT', body, schema: PipelineSchema });
```

```ts
// apps/web/lib/api/messages.ts
import { MessageResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(MessageResponseSchema);

export const listMessages = (orderId: string, limit: number, cursor: string | null) =>
  request(`/orders/${orderId}/messages`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Page,
  });

export const postMessage = (orderId: string, body: string) =>
  request(`/orders/${orderId}/messages`, {
    method: 'POST',
    body: { body },
    schema: MessageResponseSchema,
  });
```

Add to `apps/web/lib/api/orders.ts`:

```ts
export const advanceOrder = (id: string, currentStageId: string) =>
  request(`/orders/${id}/advance`, {
    method: 'POST',
    body: { currentStageId },
    schema: OrderResponseSchema,
  });

// No idempotency key: the engine conditions the cancel on the order still being
// confirmed and still in the stage the server read, so a retry is a clean 409
// rather than a replayed success.
export const cancelOrder = (id: string) =>
  request(`/orders/${id}/cancel`, { method: 'POST', schema: OrderResponseSchema });
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @marketplace/web typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api
git commit -m "feat(web): client calls for stages, advancing, cancelling and messages"
```

---

### Task 14: The stage tracker component

**Files:**
- Create: `apps/web/components/stage-tracker.tsx`
- Create: `apps/web/components/stage-tracker.test.tsx`

**Interfaces:**
- Consumes: `Stage` from contracts.
- Produces: `<StageTracker stages={Stage[]} currentStageId={string} cancelled={boolean} renderStageExtra?={(stage: Stage, state: 'done' | 'current' | 'todo') => ReactNode} />`. Task 15 passes `renderStageExtra` to slot threads in.

- [ ] **Step 1: Write the failing tests**

```tsx
// apps/web/components/stage-tracker.test.tsx
import { render, screen } from '@testing-library/react';
import { StageTracker } from './stage-tracker';

const stage = (id: string, name: string) => ({ id, name, cancellable: false, messaging: false });

describe('StageTracker', () => {
  it('renders a single-stage shop', () => {
    render(<StageTracker stages={[stage('a', 'Confirmed')]} currentStageId="a" cancelled={false} />);
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
  });

  it('renders twelve stages with names it has never seen', () => {
    const stages = Array.from({ length: 12 }, (_, i) => stage(`s${i}`, `Bespoke phase ${i}`));
    render(<StageTracker stages={stages} currentStageId="s7" cancelled={false} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByText('Bespoke phase 11')).toBeInTheDocument();
  });

  it('renders a six-stage shop with names at the length bound', () => {
    const long = 'Awaiting the framer to confirm the mount colour choice';   // 53 chars
    const stages = Array.from({ length: 6 }, (_, i) => stage(`s${i}`, `${long} ${i}`));
    render(<StageTracker stages={stages} currentStageId="s0" cancelled={false} />);
    expect(screen.getByText(`${long} 5`)).toBeInTheDocument();
  });

  it('marks where a cancelled order stopped', () => {
    render(
      <StageTracker
        stages={[stage('a', 'Packing'), stage('b', 'Shipped')]}
        currentStageId="a"
        cancelled
      />,
    );
    expect(screen.getByText(/cancelled at Packing/i)).toBeInTheDocument();
  });

  it('slots extra content under a stage', () => {
    render(
      <StageTracker
        stages={[stage('a', 'One')]}
        currentStageId="a"
        cancelled={false}
        renderStageExtra={(s) => <p>extra for {s.name}</p>}
      />,
    );
    expect(screen.getByText('extra for One')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @marketplace/web test -- stage-tracker`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/stage-tracker.tsx
'use client';

import type { ReactNode } from 'react';
import { Steps, Typography } from 'antd';
import type { Stage } from '@marketplace/contracts';

export interface StageTrackerProps {
  stages: Stage[];
  currentStageId: string;
  cancelled: boolean;
  renderStageExtra?: (stage: Stage, state: 'done' | 'current' | 'todo') => ReactNode;
}

/**
 * Rendered entirely from the snapshot the order carries. Position is
 * index-in-that-list: there is no name lookup, no assumed stage count and no
 * special case for any particular word, because a shop may call its stages
 * anything and have between one and MAX_STAGES of them.
 */
export function StageTracker({
  stages,
  currentStageId,
  cancelled,
  renderStageExtra,
}: StageTrackerProps) {
  const currentIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === currentStageId),
  );

  return (
    <>
      {cancelled ? (
        <Typography.Text type="danger">
          Cancelled at {stages[currentIndex]?.name}
        </Typography.Text>
      ) : null}
      <Steps
        direction="vertical"
        current={currentIndex}
        status={cancelled ? 'error' : 'process'}
        items={stages.map((stage, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';
          return {
            title: stage.name,
            description: renderStageExtra?.(stage, state),
          };
        })}
      />
    </>
  );
}
```

If antd's `Steps` does not expose its items as `listitem` roles, assert on `data-testid` attributes the component sets instead, and adjust the test in step 1 to match — do not weaken the twelve-stage assertion.

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @marketplace/web test -- stage-tracker`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/stage-tracker.tsx apps/web/components/stage-tracker.test.tsx
git commit -m "feat(web): a tracker that renders whatever stages an order carries"
```

---

### Task 15: The stage thread component

**Files:**
- Create: `apps/web/components/stage-thread.tsx`
- Create: `apps/web/components/stage-thread.test.tsx`

**Interfaces:**
- Consumes: `MessageResponse`; `postMessage` from Task 13.
- Produces: `<StageThread orderId messages={MessageResponse[]} open={boolean} onPosted={(m: MessageResponse) => void} />`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, screen } from '@testing-library/react';
import { StageThread } from './stage-thread';

const message = (over = {}) => ({
  entityType: 'Message' as const,
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  orderId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  stageId: 'a',
  authorUserId: 'u1',
  authorRole: 'buyer' as const,
  body: 'Any news?',
  createdAt: '2026-08-18T10:00:00.000Z',
  ...over,
});

it('shows a composer while the thread is open', () => {
  render(<StageThread orderId="o" messages={[message()]} open onPosted={() => {}} />);
  expect(screen.getByPlaceholderText(/write a message/i)).toBeInTheDocument();
});

it('shows a closed thread as history with no composer', () => {
  render(<StageThread orderId="o" messages={[message()]} open={false} onPosted={() => {}} />);
  expect(screen.getByText('Any news?')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/write a message/i)).not.toBeInTheDocument();
});

it('labels who wrote each message', () => {
  render(
    <StageThread
      orderId="o"
      messages={[message(), message({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAX', authorRole: 'seller' })]}
      open
      onPosted={() => {}}
    />,
  );
  expect(screen.getByText(/seller/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @marketplace/web test -- stage-thread`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/components/stage-thread.tsx
'use client';

import { useState } from 'react';
import { Button, Input, List, Typography } from 'antd';
import type { MessageResponse } from '@marketplace/contracts';
import { postMessage } from '../lib/api/messages';
import { formatDateTime } from '../lib/format';

export interface StageThreadProps {
  orderId: string;
  messages: MessageResponse[];
  /** The stage is the order's current one and the order is still confirmed. */
  open: boolean;
  onPosted: (message: MessageResponse) => void;
}

export function StageThread({ orderId, messages, open, onPosted }: StageThreadProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      onPosted(await postMessage(orderId, draft.trim()));
      // Cleared only after the post is known to have landed: a failed send that
      // emptied the box would lose what the buyer wrote.
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <List
        size="small"
        dataSource={messages}
        locale={{ emptyText: 'No messages' }}
        renderItem={(message) => (
          <List.Item key={message.id}>
            <List.Item.Meta
              title={
                <Typography.Text type="secondary">
                  {message.authorRole === 'buyer' ? 'Buyer' : 'Seller'} ·{' '}
                  {formatDateTime(message.createdAt)}
                </Typography.Text>
              }
              description={message.body}
            />
          </List.Item>
        )}
      />
      {open ? (
        <>
          <Input.TextArea
            rows={2}
            value={draft}
            placeholder="Write a message…"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            type="primary"
            size="small"
            loading={sending}
            disabled={draft.trim().length === 0}
            onClick={send}
            style={{ marginTop: 8 }}
          >
            Send
          </Button>
        </>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @marketplace/web test -- stage-thread`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/stage-thread.tsx apps/web/components/stage-thread.test.tsx
git commit -m "feat(web): a stage's conversation, open or closed"
```

---

### Task 16: The buyer's order page

**Files:**
- Modify: `apps/web/app/(shop)/orders/[id]/page.tsx`
- Modify: `apps/web/app/(shop)/orders/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `StageTracker` (14), `StageThread` (15), `listMessages`/`cancelOrder` (13).

- [ ] **Step 1: Write the failing tests**

```tsx
it('offers cancellation only while the current stage allows it', async () => {
  renderOrder({ stages: [stage('a', 'Packing', { cancellable: true })], currentStageId: 'a' });
  expect(await screen.findByRole('button', { name: /cancel order/i })).toBeInTheDocument();

  renderOrder({ stages: [stage('a', 'Shipped', { cancellable: false })], currentStageId: 'a' });
  expect(screen.queryByRole('button', { name: /cancel order/i })).not.toBeInTheDocument();
});

it('offers a composer only while the current stage has messaging on', async () => { /* mirror of the above */ });

it('shows a cancelled order as stopped at its stage', async () => { /* asserts /cancelled at Packing/i */ });
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @marketplace/web test -- orders`

- [ ] **Step 3: Wire the page**

Add to the existing page, beneath the hooks already declared above its early returns (a hook cannot live after a conditional `return` — the file says so):

```tsx
const { data: messagePage, retry: retryMessages } = useResource(
  () => listMessages(id, 100, null),
  [id],
);
const messages = messagePage?.items ?? [];

const currentStage = order.stages.find((stage) => stage.id === order.currentStageId);
const canCancel = order.status === 'confirmed' && currentStage?.cancellable === true;

const cancel = async () => {
  try {
    await cancelOrder(order.id);
    retry();
  } catch (err) {
    // The seller can advance the order between this page rendering and the
    // click. The engine refuses on the stage condition rather than cancelling
    // goods that just went out; the honest response is to reload and say so,
    // never to replay the click.
    if (err instanceof ProblemError && err.type.includes('stage-moved')) {
      retry();
      message.warning('This order moved to another stage. Reloaded it for you.');
      return;
    }
    throw err;
  }
};
```

and render:

```tsx
<StageTracker
  stages={order.stages}
  currentStageId={order.currentStageId}
  cancelled={order.status === 'cancelled'}
  renderStageExtra={(stage, state) => {
    if (!stage.messaging) return null;
    const forStage = messages.filter((m) => m.stageId === stage.id);
    // A past stage with nothing said in it is not worth a heading.
    if (state !== 'current' && forStage.length === 0) return null;
    return (
      <StageThread
        orderId={order.id}
        messages={forStage}
        open={state === 'current' && order.status === 'confirmed'}
        onPosted={retryMessages}
      />
    );
  }}
/>

{canCancel ? (
  // Popconfirm, never window.confirm: a native modal blocks the browser
  // harness and takes the whole campaign with it.
  <Popconfirm
    title="Cancel this order?"
    description="The items go back into stock."
    okText="Cancel order"
    cancelText="Keep it"
    onConfirm={cancel}
  >
    <Button danger>Cancel order</Button>
  </Popconfirm>
) : null}
```

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @marketplace/web test -- orders`

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(shop)/orders/[id]"
git commit -m "feat(web): a buyer watches their order move, and talks to the shop"
```

---

### Task 17: Stage name on the orders list

**Files:**
- Modify: `apps/web/app/(shop)/orders/page.tsx`

- [ ] **Step 1: Write the failing test**

Assert that a row for an order whose `currentStageId` names "Mount cut" renders that text, alongside the existing status tag.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @marketplace/web test -- orders`

- [ ] **Step 3: Add the column**

```tsx
{
  title: 'Stage',
  key: 'stage',
  // Resolved from the row's own snapshot, never from a pipeline fetch: an order
  // placed under an older version must show the name it was placed with, and a
  // shared fetch would relabel every historical row on the owner's next rename.
  render: (_: unknown, order: OrderResponse) =>
    order.stages.find((stage) => stage.id === order.currentStageId)?.name ?? '—',
},
```

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(shop)/orders/page.tsx"
git commit -m "feat(web): an order row says which stage it is in"
```

---

### Task 18: The owner's stage editor

**Files:**
- Create: `apps/web/app/(admin)/admin/settings/stage-editor.tsx`
- Create: `apps/web/app/(admin)/admin/settings/stage-editor.test.tsx`
- Modify: `apps/web/app/(admin)/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `getPipeline`, `savePipeline` (13); `StageTracker` (14) for the preview.

- [ ] **Step 1: Write the failing tests**

```tsx
it('adds, renames and removes stages', async () => { /* … */ });

it('previews the buyer’s tracker from the stages as edited', async () => {
  // rename a stage, assert the preview shows the new name
});

it('refuses to save an empty stage list', async () => {
  // remove the last stage; the save button is disabled and a hint explains why
});

it('tells the owner to reload when someone else saved first', async () => {
  // savePipeline rejects with a ProblemError of type pipeline-version-conflict
  expect(await screen.findByText(/someone else saved/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `pnpm --filter @marketplace/web test -- stage-editor`

- [ ] **Step 3: Build the editor**

```tsx
// apps/web/app/(admin)/admin/settings/stage-editor.tsx
'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Switch, Typography, message } from 'antd';
import { MAX_STAGES, type StageInput } from '@marketplace/contracts';
import { getPipeline, savePipeline } from '../../../../lib/api/pipeline';
import { ProblemError } from '../../../../lib/api/http';
import { StageTracker } from '../../../../components/stage-tracker';

/** A stage being edited: no id until the service mints one on save. */
type Draft = StageInput & { key: string };

export function StageEditor() {
  const [version, setVersion] = useState(0);
  const [stages, setStages] = useState<Draft[]>([]);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    void getPipeline().then((pipeline) => {
      setVersion(pipeline.version);
      setStages(pipeline.stages.map((stage) => ({ ...stage, key: stage.id })));
    });
  }, []);

  const patch = (key: string, change: Partial<Draft>) =>
    setStages((current) => current.map((s) => (s.key === key ? { ...s, ...change } : s)));

  const move = (index: number, by: number) =>
    setStages((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved);
      return next;
    });

  const save = async () => {
    try {
      const saved = await savePipeline({
        version,
        stages: stages.map(({ key: _key, ...stage }) => stage),
      });
      setVersion(saved.version);
      setStages(saved.stages.map((stage) => ({ ...stage, key: stage.id })));
      setStale(false);
      message.success('Order stages published');
    } catch (err) {
      // Bug #9's lesson, one layer up: a stale save must not silently clobber
      // the one it never saw.
      if (err instanceof ProblemError && err.type.includes('pipeline-version-conflict')) {
        setStale(true);
        return;
      }
      throw err;
    }
  };

  return (
    <Card title="Order stages">
      {stale ? (
        <Alert
          type="warning"
          message="Someone else saved the order stages while you were editing."
          description="Reload to see their version, then reapply your changes."
          action={<Button onClick={() => window.location.reload()}>Reload</Button>}
        />
      ) : null}

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: 1 }}>
          {stages.map((stage, index) => (
            <div key={stage.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <Input
                value={stage.name}
                onChange={(event) => patch(stage.key, { name: event.target.value })}
              />
              <Switch
                checkedChildren="cancel"
                checked={stage.cancellable}
                onChange={(on) => patch(stage.key, { cancellable: on })}
              />
              <Switch
                checkedChildren="messages"
                checked={stage.messaging}
                onChange={(on) => patch(stage.key, { messaging: on })}
              />
              <Button disabled={index === 0} onClick={() => move(index, -1)}>↑</Button>
              <Button disabled={index === stages.length - 1} onClick={() => move(index, 1)}>↓</Button>
              <Button
                danger
                // One stage is the floor: PipelineSchema requires at least one,
                // and a shop with none has no lifecycle to place an order into.
                disabled={stages.length === 1}
                onClick={() => setStages((c) => c.filter((s) => s.key !== stage.key))}
              >
                ✕
              </Button>
            </div>
          ))}

          <Button
            disabled={stages.length >= MAX_STAGES}
            onClick={() =>
              setStages((c) => [
                ...c,
                { key: `new-${c.length}`, name: '', cancellable: false, messaging: false },
              ])
            }
          >
            + Add stage
          </Button>
        </div>

        <div style={{ flex: 1 }}>
          <Typography.Text type="secondary">Preview — what a buyer sees</Typography.Text>
          <StageTracker
            stages={stages.map((stage, i) => ({ ...stage, id: stage.id ?? `preview-${i}` }))}
            currentStageId={stages[0]?.id ?? 'preview-0'}
            cancelled={false}
          />
        </div>
      </div>

      <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
        Saving publishes a new version. Orders already placed keep walking the stages they were
        placed under, so a rename or a reorder only affects orders taken from now on.
      </Typography.Paragraph>

      <Button
        type="primary"
        disabled={stages.length === 0 || stages.some((s) => s.name.trim() === '')}
        onClick={save}
      >
        Publish stages
      </Button>
    </Card>
  );
}
```

Mount `<StageEditor />` in `apps/web/app/(admin)/admin/settings/page.tsx` beside the announcement section.

- [ ] **Step 4: Run and watch them pass**

Run: `pnpm --filter @marketplace/web test -- stage-editor`

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/settings"
git commit -m "feat(web): a shop owner names its order stages"
```

---

### Task 19: The seller's order page

**Files:**
- Modify: the cockpit order detail page under `apps/web/app/(admin)/`

- [ ] **Step 1: Write the failing test**

Assert an "Advance to Mount cut" button naming the *next* stage; that it is absent or disabled on the final stage; and that the seller's composer appears on a messaging stage.

- [ ] **Step 2: Run and watch it fail**

- [ ] **Step 3: Wire it**

```tsx
const index = order.stages.findIndex((stage) => stage.id === order.currentStageId);
const next = order.stages[index + 1];

const advance = async () => {
  try {
    await advanceOrder(order.id, order.currentStageId);
    retry();
  } catch (err) {
    if (err instanceof ProblemError && err.type.includes('stage-moved')) {
      retry();
      message.warning('Another admin moved this order. Reloaded it for you.');
      return;
    }
    throw err;
  }
};

// Rendered only when there is somewhere to go. A shop that has never configured
// its stages has exactly one, so every advance there is a legitimate 409 -- the
// seller should meet that as a missing button, not as an error.
{next && order.status === 'confirmed' ? (
  <Button type="primary" onClick={advance}>
    Advance to {next.name}
  </Button>
) : null}
```

Reuse `<StageTracker>` with the same `renderStageExtra`/`<StageThread>` wiring as Task 16 — the seller's role is decided by the engine from the principal, so the component needs no flag.

- [ ] **Step 4: Run and watch it pass**

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)"
git commit -m "feat(web): a seller advances an order and answers its thread"
```

---

### Task 20: The data-driven browser journey, and screenshots

**Files:**
- Create: `apps/web/e2e/journeys/order-stages.spec.ts`

- [ ] **Step 1: Write the journey**

One path, using stage names the code has never seen, proving nothing is hardcoded:

1. Owner publishes `Order received` (cancellable, messaging) → `Mount cut` (messaging) → `Collected`.
2. Buyer orders a product with known stock.
3. Buyer's order page shows the tracker at `Order received`.
4. Buyer posts a message; it appears.
5. Seller advances; the buyer's page shows `Mount cut`, the first thread read-only, a composer on the new stage.
6. Seller advances to `Collected`; the cancel control is gone.
7. On a second order, buyer cancels at `Order received`; the product page shows the stock back.

Base URL stays on `localhost` — the page origin must match what the engine allows — while any host-side fetch in the harness uses `127.0.0.1`.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @marketplace/web e2e:journeys -- order-stages`
Expected: PASS.

- [ ] **Step 3: Capture screenshots and look at them**

Capture the tracker at 1, 6 and 12 stages, and the editor. Passing tests prove behaviour, not that a twelve-stage tracker still looks like anything. Fix what looks wrong before committing.

- [ ] **Step 4: Run the whole suite**

Run: `npx turbo run test --concurrency=1`
Expected: every package green. Re-run any red suite alone before believing it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/journeys/order-stages.spec.ts
git commit -m "test(web): a shop's own stages, end to end"
```

---

## Notes for the executor

- **Task 9's pinning test is the one that matters most.** If it fails, `create` is re-reading the pipeline rather than copying it. Fix the service, never the test.
- **Never insert a transaction item before the line-item updates** in `orders.service.ts`. `explainFailure` maps a failed index back to a product on the assumption that items `0..n-1` are stock updates.
- **`ProblemType` is a closed union.** A new code that is not in it will not compile at the throw site.
- **Assert on outcomes, not error classes, in race tests.** DynamoDB Local surfaces `ConditionalCheckFailed` where a real table gives `TransactionConflict`.
- **A one-stage shop is the normal case, not an edge case.** Every shop starts there, and `advance` correctly refuses in it.
