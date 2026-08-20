# Owner Onboarding: Storefront Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent that interviews a new owner about their business, then generates and previews a themed storefront (preset + tuning), About page and banners, which the owner publishes explicitly.

**Architecture:** New `storefront` contracts + engine module (draft/published pair in the single table), a second LangGraph graph in the agents service routed by a new thread `kind`, and web-side preset theming resolved by one pure function applied to the `(shop)` wrapper. Wizard = chat pane + live preview at `(admin)/admin/onboarding`. ComfyUI image generation is an optional engine provider behind `IMAGE_GEN_URL`.

**Tech Stack:** zod contracts, NestJS + DynamoDB single table, LangGraph + Redis checkpointer + ollama (scripted provider in tests), Next.js + antd, vitest/jest, docker compose.

**Spec:** `docs/superpowers/specs/2026-08-20-owner-onboarding-storefront-theming-design.md`

## Global Constraints

- No floats for money (no money in this feature; keep it that way).
- Every engine/agents error is an RFC 9457 problem; new codes added to the closed `ProblemType` union in `apps/engine/src/common/problem.ts` (engine) or `apps/agents/src/common/problem.ts` (agents) **before** use.
- Admin-only engine routes carry **both** `@Roles('admin')` and a service-level check.
- Ownership failures answer 404, never 403. Role failures on a tenant's own settings answer 403 (settings-module precedent).
- Never `window.confirm`/`alert`/`prompt` in web code — antd `Popconfirm`.
- Repo-wide test runs: `npx turbo run test --concurrency=1`. Re-run a red suite alone before believing it.
- Host-side harnesses hit `127.0.0.1`; browser base URLs stay `localhost`.
- Type checking is `build`: run `pnpm --filter @marketplace/web build` (and `nest build` for services) before calling work done.
- Commits carry no Claude attribution trailer.

## Spec deviations locked in by this plan (codebase reality)

1. Theme is applied **client-side** on the `(shop)` wrapper — the shop shell (`apps/web/app/(shop)/layout.tsx`) is a `'use client'` component whose auth is client-held; there is no server fetch path. No-flash is preserved because the shell already renders `null` until auth is ready; config fetch joins that gate.
2. Banner art stores a public **`imageUrl`** (`z.string().url()`), matching how `ProductRecord.images` stores what `POST /uploads/product-image` returns — the spec's "objectKey" wording is replaced by the codebase convention.
3. The spec's `applyFeedback` node is folded into the generate path: on a message to a thread already in phase `drafted`, the graph re-enters `proposeTheme → draftContent → assembleDraft → dispatchDraft` with full conversation history, which is how the revision loop revises "the relevant slice" without a second LLM routing step.

---

### Task 1: Storefront contracts

**Files:**
- Create: `packages/contracts/src/storefront.ts`
- Create: `packages/contracts/src/storefront.test.ts`
- Modify: `packages/contracts/src/index.ts` (add `export * from './storefront';` beside the existing exports)

**Interfaces:**
- Consumes: `UlidSchema` from `./common` (not needed if banner ids are plain strings — banner ids are `z.string().min(1).max(40)`, chosen by the agent/wizard, not ULIDs).
- Produces (later tasks rely on these exact names):
  `PRESET_IDS`, `PresetIdSchema`, `PresetId`,
  `RADIUS_SCALES`, `RadiusScaleSchema`, `RadiusScale`,
  `FONT_PAIRINGS`, `FontPairingSchema`, `FontPairing`,
  `HexColorSchema`, `contrastRatio(a: string, b: string): number`,
  `PRESET_SURFACES: Record<PresetId, { light: string; dark: string }>`,
  `ThemeOverridesSchema`, `ThemeOverrides`,
  `BANNER_SLOTS`, `BannerSlotSchema`, `BannerSlot`,
  `BannerSchema`, `Banner`,
  `AboutPageSchema`, `AboutPage`,
  `BusinessProfileSchema`, `BusinessProfile`,
  `StorefrontConfigSchema`, `StorefrontConfig`,
  `StorefrontDraftResponseSchema`, `StorefrontDraftResponse`,
  `OnboardingFlagSchema`, `OnboardingFlag`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/storefront.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  BannerSchema,
  contrastRatio,
  PRESET_IDS,
  PRESET_SURFACES,
  StorefrontConfigSchema,
  ThemeOverridesSchema,
} from './storefront';

const validConfig = {
  presetId: 'artisan',
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      cta: { label: 'Browse the shelf', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: {
    kind: 'ceramics studio',
    name: 'Kiln & Loom',
    tone: 'warm, personal',
    audience: 'gift shoppers',
  },
};

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('is symmetric', () => {
    expect(contrastRatio('#0f766e', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#0f766e'),
      5,
    );
  });
});

describe('PRESET_SURFACES', () => {
  it('covers every preset id with light and dark hex surfaces', () => {
    for (const id of PRESET_IDS) {
      expect(PRESET_SURFACES[id].light).toMatch(/^#[0-9a-f]{6}$/i);
      expect(PRESET_SURFACES[id].dark).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('ThemeOverridesSchema', () => {
  it('accepts an accent white text can sit on', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#0f766e' }).success).toBe(true);
  });
  it('rejects an accent too light for white text (fill rule, 4.5:1)', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#ffe94a' }).success).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(ThemeOverridesSchema.safeParse({ accent: '#0f766e', spacing: 2 }).success).toBe(false);
  });
});

describe('BannerSchema', () => {
  it('rejects a generated banner without an imageUrl', () => {
    const banner = { ...validConfig.banners[0], art: { kind: 'generated' } };
    expect(BannerSchema.safeParse(banner).success).toBe(false);
  });
});

describe('StorefrontConfigSchema', () => {
  it('accepts the reference config', () => {
    expect(StorefrontConfigSchema.safeParse(validConfig).success).toBe(true);
  });
  it('rejects two banners in one slot', () => {
    const twice = {
      ...validConfig,
      banners: [validConfig.banners[0], { ...validConfig.banners[0], id: 'hero-2' }],
    };
    expect(StorefrontConfigSchema.safeParse(twice).success).toBe(false);
  });
  it('rejects a fourth banner', () => {
    const four = {
      ...validConfig,
      banners: ['hero', 'mid', 'footer', 'hero'].map((slot, i) => ({
        ...validConfig.banners[0],
        id: `b-${i}`,
        slot,
      })),
    };
    expect(StorefrontConfigSchema.safeParse(four).success).toBe(false);
  });
  it('rejects more than six about sections', () => {
    const s = { heading: 'h', body: 'b' };
    const many = { ...validConfig, about: { title: 't', sections: Array(7).fill(s) } };
    expect(StorefrontConfigSchema.safeParse(many).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/contracts test -- storefront`
Expected: FAIL — cannot resolve `./storefront`.

- [ ] **Step 3: Write the implementation**

`packages/contracts/src/storefront.ts`:

```ts
import { z } from 'zod';

export const PRESET_IDS = ['artisan', 'tech', 'editorial', 'market', 'studio'] as const;
export const PresetIdSchema = z.enum(PRESET_IDS);
export type PresetId = z.infer<typeof PresetIdSchema>;

export const RADIUS_SCALES = ['sharp', 'soft', 'round'] as const;
export const RadiusScaleSchema = z.enum(RADIUS_SCALES);
export type RadiusScale = z.infer<typeof RadiusScaleSchema>;

export const FONT_PAIRINGS = ['inter', 'fraunces', 'playfair', 'nunito'] as const;
export const FontPairingSchema = z.enum(FONT_PAIRINGS);
export type FontPairing = z.infer<typeof FontPairingSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'must be #rrggbb');

/**
 * WCAG 2.x relative-luminance contrast. Lives in contracts because the accent
 * refinement below needs it on every write path -- engine, agents and web all
 * validate with the same function, so "the agent cannot store an unreadable
 * colour" is a property of the schema, not of any one service.
 */
export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16);
    const channel = (v: number): number => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return (
      0.2126 * channel((n >> 16) & 0xff) +
      0.7152 * channel((n >> 8) & 0xff) +
      0.0722 * channel(n & 0xff)
    );
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The base page surface of each preset, light and dark. The one slice of the
 * presets that lives in contracts: web's presets.ts imports these values for
 * its surfaces so validation and rendering cannot drift.
 */
export const PRESET_SURFACES: Record<PresetId, { light: string; dark: string }> = {
  artisan: { light: '#faf6ef', dark: '#171310' },
  tech: { light: '#f5f7fb', dark: '#0a0e17' },
  editorial: { light: '#ffffff', dark: '#101010' },
  market: { light: '#fffdf7', dark: '#12160e' },
  studio: { light: '#f6f5f3', dark: '#161512' },
};

/**
 * The accent is a *fill*: primary buttons paint it with white text, so white
 * on accent must clear 4.5:1. Whether it can also serve as text on a given
 * surface is decided at resolve time (web falls back to the preset's own text
 * accent when it cannot) -- a single hex cannot clear both modes' surfaces as
 * text, and demanding it would reject nearly every reasonable colour.
 */
export const ThemeOverridesSchema = z
  .object({
    accent: HexColorSchema.optional(),
    radiusScale: RadiusScaleSchema.optional(),
    fontPairing: FontPairingSchema.optional(),
    heroStyle: z.enum(['gradient', 'image']).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.accent && contrastRatio('#ffffff', val.accent) < 4.5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accent'],
        message: 'accent must keep white text at 4.5:1 or better',
      });
    }
  });
export type ThemeOverrides = z.infer<typeof ThemeOverridesSchema>;

export const BANNER_SLOTS = ['hero', 'mid', 'footer'] as const;
export const BannerSlotSchema = z.enum(BANNER_SLOTS);
export type BannerSlot = z.infer<typeof BannerSlotSchema>;

const BannerArtSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('css') }).strict(),
  z.object({ kind: z.literal('upload'), imageUrl: z.string().url() }).strict(),
  z.object({ kind: z.literal('generated'), imageUrl: z.string().url() }).strict(),
]);

export const BannerSchema = z
  .object({
    id: z.string().min(1).max(40),
    slot: BannerSlotSchema,
    headline: z.string().trim().min(1).max(80),
    subline: z.string().trim().min(1).max(160),
    cta: z
      .object({
        label: z.string().trim().min(1).max(30),
        href: z.string().min(1).max(200),
      })
      .strict(),
    art: BannerArtSchema,
  })
  .strict();
export type Banner = z.infer<typeof BannerSchema>;

export const AboutPageSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    sections: z
      .array(
        z
          .object({
            heading: z.string().trim().min(1).max(80),
            body: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type AboutPage = z.infer<typeof AboutPageSchema>;

export const BusinessProfileSchema = z
  .object({
    kind: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200),
    tone: z.string().trim().min(1).max(200),
    audience: z.string().trim().min(1).max(200),
  })
  .strict();
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

export const StorefrontConfigSchema = z
  .object({
    presetId: PresetIdSchema,
    overrides: ThemeOverridesSchema,
    about: AboutPageSchema,
    banners: z.array(BannerSchema).max(3),
    businessProfile: BusinessProfileSchema,
  })
  .strict()
  .superRefine((val, ctx) => {
    const slots = val.banners.map((b) => b.slot);
    if (new Set(slots).size !== slots.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['banners'],
        message: 'at most one banner per slot',
      });
    }
  });
export type StorefrontConfig = z.infer<typeof StorefrontConfigSchema>;

/** GET /storefront/draft: the draft plus what this deployment can do. */
export const StorefrontDraftResponseSchema = z.object({
  draft: StorefrontConfigSchema.nullable(),
  capabilities: z.object({ imageGen: z.boolean() }),
});
export type StorefrontDraftResponse = z.infer<typeof StorefrontDraftResponseSchema>;

/** The owner's "don't show me the wizard again" flag. */
export const OnboardingFlagSchema = z.object({ dismissed: z.boolean() }).strict();
export type OnboardingFlag = z.infer<typeof OnboardingFlagSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @marketplace/contracts test -- storefront`
Expected: PASS.

Add the export to `packages/contracts/src/index.ts` and run the whole package: `pnpm --filter @marketplace/contracts test` — all green (the index test enumerates exports; follow its failure message if it pins a list).

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/storefront.ts packages/contracts/src/storefront.test.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): storefront config, theme overrides with contrast floor, banners, about page"
```

---

### Task 2: Agent-protocol contracts for onboarding threads

**Files:**
- Modify: `packages/contracts/src/agent.ts`
- Modify: `packages/contracts/src/agent.test.ts` (extend the existing suite)

**Interfaces:**
- Consumes: `StorefrontConfigSchema`, `ChatMessageSchema` (already in agent.ts), `UlidSchema`.
- Produces: `ThreadKindSchema` / `ThreadKind` (`'schema' | 'onboarding'`), `ThreadStartSchema` / `ThreadStart` (`{ kind }`, strict, `kind` defaulting to `'schema'`), `OnboardingPhaseSchema` / `OnboardingPhase` (`'gathering' | 'generating' | 'drafted'`), `OnboardingSnapshotSchema` / `OnboardingSnapshot`, and `AgentSnapshot = AgentStateSnapshot | OnboardingSnapshot`.

- [ ] **Step 1: Write the failing tests** (append to `agent.test.ts`, matching its existing style)

```ts
describe('ThreadStartSchema', () => {
  it('defaults kind to schema for an empty payload', () => {
    expect(ThreadStartSchema.parse({})).toEqual({ kind: 'schema' });
  });
  it('accepts onboarding', () => {
    expect(ThreadStartSchema.parse({ kind: 'onboarding' })).toEqual({ kind: 'onboarding' });
  });
  it('rejects unknown keys', () => {
    expect(ThreadStartSchema.safeParse({ kind: 'schema', x: 1 }).success).toBe(false);
  });
});

describe('OnboardingSnapshotSchema', () => {
  it('accepts a drafted snapshot', () => {
    const snap = {
      threadId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      kind: 'onboarding',
      phase: 'drafted',
      messages: [{ role: 'assistant', content: 'done' }],
      draft: null,
    };
    expect(OnboardingSnapshotSchema.safeParse(snap).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @marketplace/contracts test -- agent` → FAIL (names not exported).

- [ ] **Step 3: Implement** (append to `agent.ts`)

```ts
import { StorefrontConfigSchema } from './storefront'; // at top of file

export const ThreadKindSchema = z.enum(['schema', 'onboarding']);
export type ThreadKind = z.infer<typeof ThreadKindSchema>;

/** thread.start payload. Optional on the wire: the gateway parses `body ?? {}`. */
export const ThreadStartSchema = z
  .object({ kind: ThreadKindSchema.default('schema') })
  .strict();
export type ThreadStart = z.infer<typeof ThreadStartSchema>;

export const OnboardingPhaseSchema = z.enum(['gathering', 'generating', 'drafted']);
export type OnboardingPhase = z.infer<typeof OnboardingPhaseSchema>;

/**
 * Non-strict like AgentStateSnapshotSchema, and carries `kind` so a client can
 * discriminate the union (the schema snapshot predates kinds and has none).
 */
export const OnboardingSnapshotSchema = z.object({
  threadId: UlidSchema,
  kind: z.literal('onboarding'),
  phase: OnboardingPhaseSchema,
  messages: z.array(ChatMessageSchema),
  draft: StorefrontConfigSchema.nullable(),
});
export type OnboardingSnapshot = z.infer<typeof OnboardingSnapshotSchema>;

export type AgentSnapshot = AgentStateSnapshot | OnboardingSnapshot;
```

- [ ] **Step 4: Run** `pnpm --filter @marketplace/contracts test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/agent.ts packages/contracts/src/agent.test.ts
git commit -m "feat(contracts): thread kinds and onboarding snapshot for the agents protocol"
```

---

### Task 3: Engine storefront service

**Files:**
- Create: `apps/engine/src/storefront/storefront.service.ts`
- Create: `apps/engine/src/storefront/storefront.service.test.ts`
- Modify: `apps/engine/src/common/problem.ts` (add `'storefront-draft-not-found'` to the union, with a comment in the file's style)

**Interfaces:**
- Consumes: `DynamoRepository` (`get<T>(sk)`, `put(sk, item)` — read `apps/engine/src/persistence/dynamo.repository.ts` before writing to confirm exact signatures; the settings service at `apps/engine/src/settings/settings.service.ts` is the model to copy), `settingsSk()` from `../persistence/keys`, `currentPrincipal()` from `../common/tenant-context`, contracts from Task 1.
- Produces:
  ```ts
  class StorefrontService {
    getPublished(): Promise<StorefrontConfig | null>
    getDraft(): Promise<StorefrontDraftResponse>          // admin
    putDraft(config: StorefrontConfig): Promise<StorefrontConfig>  // admin
    publish(): Promise<StorefrontConfig>                  // admin; problem if no draft
    getOnboardingFlag(): Promise<OnboardingFlag>          // any signed-in user
    putOnboardingFlag(flag: OnboardingFlag): Promise<OnboardingFlag> // admin
  }
  ```
  Storage keys: `settingsSk('storefront')`, `settingsSk('storefront-draft')`, `settingsSk('storefront-onboarding')`. The `imageGen` capability is injected as a constructor boolean (`imageGenEnabled`), so the service has no env coupling.

- [ ] **Step 1: Write failing tests** — mirror the mocking approach of `apps/engine/src/settings/settings.service.test.ts` (read it first; it shows how `currentPrincipal` and the repo are stubbed there). Cover:

```ts
// shape of the cases; adapt the harness from settings.service.test.ts
it('getPublished returns null when the tenant has no config', ...);
it('getPublished parses and returns a stored config', ...);
it('putDraft rejects a non-admin with a 403 problem', ...);
it('putDraft stores the config under SETTINGS#storefront-draft', ...);
it('publish copies draft over published and returns it', ...);
it('publish with no draft throws storefront-draft-not-found (404)', ...);
it('getDraft reports imageGen capability from its constructor flag', ...);
it('getOnboardingFlag defaults to { dismissed: false } when absent', ...);
it('putOnboardingFlag rejects a non-admin with a 403 problem', ...);
```

Each test body asserts on outcome (returned value / `repo.put` called with the exact SK and item / `rejects.toThrow(/no draft/i)` style), not on internals.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @marketplace/engine test -- storefront.service` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { Injectable } from '@nestjs/common';
import {
  OnboardingFlag,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { settingsSk } from '../persistence/keys';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';

const PUBLISHED_SK = settingsSk('storefront');
const DRAFT_SK = settingsSk('storefront-draft');
const ONBOARDING_SK = settingsSk('storefront-onboarding');

@Injectable()
export class StorefrontService {
  constructor(
    private readonly repo: DynamoRepository,
    /** Wired from env in the module; the service itself stays env-free. */
    private readonly imageGenEnabled: boolean,
  ) {}

  private assertAdmin(action: string): void {
    if (currentPrincipal().role !== 'admin') {
      throw new ProblemException('forbidden', 403, `Only an admin can ${action}`);
    }
  }

  /** Absence is a state: a store that never ran the wizard renders the default theme. */
  async getPublished(): Promise<StorefrontConfig | null> {
    const found = await this.repo.get<StorefrontConfig>(PUBLISHED_SK);
    return found ? StorefrontConfigSchema.parse(found) : null;
  }

  async getDraft(): Promise<StorefrontDraftResponse> {
    this.assertAdmin('read the storefront draft');
    const found = await this.repo.get<StorefrontConfig>(DRAFT_SK);
    return {
      draft: found ? StorefrontConfigSchema.parse(found) : null,
      capabilities: { imageGen: this.imageGenEnabled },
    };
  }

  async putDraft(config: StorefrontConfig): Promise<StorefrontConfig> {
    this.assertAdmin('edit the storefront draft');
    const parsed = StorefrontConfigSchema.parse(config);
    await this.repo.put(DRAFT_SK, parsed);
    return parsed;
  }

  async publish(): Promise<StorefrontConfig> {
    this.assertAdmin('publish the storefront');
    const draft = await this.repo.get<StorefrontConfig>(DRAFT_SK);
    if (!draft) {
      throw new ProblemException(
        'storefront-draft-not-found',
        404,
        'There is no draft to publish',
      );
    }
    const parsed = StorefrontConfigSchema.parse(draft);
    await this.repo.put(PUBLISHED_SK, parsed);
    return parsed;
  }

  async getOnboardingFlag(): Promise<OnboardingFlag> {
    const found = await this.repo.get<OnboardingFlag>(ONBOARDING_SK);
    return found ? { dismissed: found.dismissed === true } : { dismissed: false };
  }

  async putOnboardingFlag(flag: OnboardingFlag): Promise<OnboardingFlag> {
    this.assertAdmin('dismiss onboarding');
    await this.repo.put(ONBOARDING_SK, { dismissed: flag.dismissed });
    return flag;
  }
}
```

If `DynamoRepository`'s actual `get`/`put` signatures differ from the settings service's usage, follow the settings service — it is the pattern this module copies.

- [ ] **Step 4: Run** `pnpm --filter @marketplace/engine test -- storefront.service` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engine/src/storefront apps/engine/src/common/problem.ts
git commit -m "feat(engine): storefront draft/published service with onboarding flag"
```

---

### Task 4: Engine storefront controller, module, e2e

**Files:**
- Create: `apps/engine/src/storefront/storefront.controller.ts`
- Create: `apps/engine/src/storefront/storefront.module.ts`
- Modify: `apps/engine/src/app.module.ts` (import `StorefrontModule` beside `SettingsModule`)
- Modify: `apps/engine/src/config/env.schema.ts` (add `IMAGE_GEN_URL: z.string().url().optional()`)
- Create: `apps/engine/test/e2e/storefront.e2e.test.ts`

**Interfaces:**
- Consumes: `StorefrontService` (Task 3), `@Roles('admin')`, `ZodBody` from `../common/zod-validation.pipe` (as `settings.controller.ts` uses them).
- Produces HTTP routes (all under the engine's global prefix, same as `/settings/*`):
  `GET /storefront`, `GET /storefront/draft`, `PUT /storefront/draft`, `POST /storefront/publish`, `GET /storefront/onboarding`, `PUT /storefront/onboarding`.

- [ ] **Step 1: Controller + module**

```ts
// storefront.controller.ts
import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import {
  OnboardingFlag,
  OnboardingFlagSchema,
  StorefrontConfig,
  StorefrontConfigSchema,
  StorefrontDraftResponse,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { Roles } from '../auth/roles.decorator';
import { StorefrontService } from './storefront.service';

@Controller('storefront')
export class StorefrontController {
  constructor(private readonly storefront: StorefrontService) {}

  @Get()
  getPublished(): Promise<StorefrontConfig | null> {
    return this.storefront.getPublished();
  }

  // Declared here as well as checked in the service, like every admin write.
  @Get('draft')
  @Roles('admin')
  getDraft(): Promise<StorefrontDraftResponse> {
    return this.storefront.getDraft();
  }

  @Put('draft')
  @Roles('admin')
  putDraft(@ZodBody(StorefrontConfigSchema) body: StorefrontConfig): Promise<StorefrontConfig> {
    return this.storefront.putDraft(body);
  }

  @Post('publish')
  @Roles('admin')
  publish(): Promise<StorefrontConfig> {
    return this.storefront.publish();
  }

  @Get('onboarding')
  getOnboardingFlag(): Promise<OnboardingFlag> {
    return this.storefront.getOnboardingFlag();
  }

  @Put('onboarding')
  @Roles('admin')
  putOnboardingFlag(@ZodBody(OnboardingFlagSchema) body: OnboardingFlag): Promise<OnboardingFlag> {
    return this.storefront.putOnboardingFlag(body);
  }
}
```

```ts
// storefront.module.ts
import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { StorefrontController } from './storefront.controller';
import { StorefrontService } from './storefront.service';
import { ENV, EnvConfig } from '../config/env.schema';
import { DynamoRepository } from '../persistence/dynamo.repository';

@Module({
  imports: [PersistenceModule],
  controllers: [StorefrontController],
  providers: [
    {
      provide: StorefrontService,
      inject: [DynamoRepository, ENV],
      useFactory: (repo: DynamoRepository, env: EnvConfig) =>
        new StorefrontService(repo, Boolean(env.IMAGE_GEN_URL)),
    },
  ],
  exports: [StorefrontService],
})
export class StorefrontModule {}
```

Check `settings.module.ts` first — if it does not import a `PersistenceModule` (the repo may be provided globally), mirror exactly what it does instead of the imports line above.

- [ ] **Step 2: Build to surface type errors** — `pnpm --filter @marketplace/engine build` → clean.

- [ ] **Step 3: e2e test** — model `apps/engine/test/e2e/storefront.e2e.test.ts` on `apps/engine/test/e2e/threads.e2e.test.ts` for its helper imports (`setup.ts`, `helpers/`) and auth token acquisition. The suite (against a running stack):

1. As a non-admin: `GET /storefront` → 200 `null`-ish body; `GET /storefront/draft` → 403 problem; `PUT /storefront/draft` → 403.
2. As admin: `GET /storefront/draft` → `{ draft: null, capabilities: { imageGen: false } }`.
3. As admin: `POST /storefront/publish` with no draft → 404 problem with `type` ending `storefront-draft-not-found`.
4. As admin: `PUT /storefront/draft` with the reference config from Task 1's test → 200 echo; `POST /storefront/publish` → 200; as non-admin `GET /storefront` → the published config.
5. `PUT /storefront/draft` with a low-contrast accent (`#ffe94a`) → 400 problem with an `errors[]` entry whose `field` is `overrides.accent`.
6. Admin `PUT /storefront/onboarding` `{ dismissed: true }` → 200; `GET /storefront/onboarding` → `{ dismissed: true }`.

- [ ] **Step 4: Run it** — boot the stack (`pnpm docker:up` if not running), then `pnpm --filter @marketplace/engine test:e2e -- storefront` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/engine/src/storefront apps/engine/src/app.module.ts apps/engine/src/config/env.schema.ts apps/engine/test/e2e/storefront.e2e.test.ts
git commit -m "feat(engine): storefront routes with draft/publish and onboarding flag"
```

---

### Task 5: Web presets and resolveTheme

**Files:**
- Create: `apps/web/lib/theme/presets.ts`
- Create: `apps/web/lib/theme/resolve.ts`
- Create: `apps/web/lib/theme/resolve.test.ts`
- Modify: `apps/web/app/layout.tsx` (load the three new font families beside Inter)

**Interfaces:**
- Consumes: `palette`, `radius`, `cssVars`, `Mode` from `./tokens`; `PRESET_SURFACES`, `contrastRatio`, `PresetId`, `StorefrontConfig`, `FontPairing`, `RadiusScale` from `@marketplace/contracts`.
- Produces:
  ```ts
  // presets.ts
  export interface PresetPalette { /* same keys as tokens.ts `palette` */ }
  export interface Preset {
    id: PresetId;
    light: PresetPalette; dark: PresetPalette;
    accentText: { light: string; dark: string };  // accent-as-text per mode, pre-checked
    heroBg: { light: string; dark: string };      // CSS background value
    fontFamilyVar: Record<FontPairing, string>;   // shared map, see below
    defaultRadius: RadiusScale;
    defaultFontPairing: FontPairing;
  }
  export const PRESETS: Record<PresetId, Preset>;
  export const FONT_STACKS: Record<FontPairing, { heading: string; body: string }>;
  export const RADIUS_VALUES: Record<RadiusScale, { sm: number; md: number; lg: number; xl: number }>;

  // resolve.ts
  export function resolveTheme(config: StorefrontConfig | null, mode: Mode): Record<string, string>;
  export function resolveAntdAccent(config: StorefrontConfig | null, mode: Mode): string | null;
  ```
  `resolveTheme(null, mode)` returns exactly `cssVars(mode)` — byte-identical default. With a config it returns the same key set with preset + override values substituted. `--mp-font-heading` and `--mp-font-body` are two NEW variables it always emits (default: the Inter stack), which `theme.css` may consume later; existing variables keep their names.

- [ ] **Step 1: Failing tests** (`resolve.test.ts`, vitest):

```ts
import { describe, expect, it } from 'vitest';
import { PRESET_IDS, PRESET_SURFACES, contrastRatio } from '@marketplace/contracts';
import { cssVars } from './tokens';
import { PRESETS } from './presets';
import { resolveTheme } from './resolve';

const baseConfig = (presetId: (typeof PRESET_IDS)[number]) => ({
  presetId,
  overrides: {},
  about: { title: 't', sections: [{ heading: 'h', body: 'b' }] },
  banners: [],
  businessProfile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
});

describe('resolveTheme', () => {
  it('null config is byte-identical to the default cssVars, both modes', () => {
    expect(resolveTheme(null, 'light')).toEqual({
      ...cssVars('light'),
      '--mp-font-heading': expect.any(String),
      '--mp-font-body': expect.any(String),
    });
    expect(resolveTheme(null, 'dark')['--mp-surface']).toBe(cssVars('dark')['--mp-surface']);
  });

  it('every preset emits the full default key set in both modes', () => {
    const keys = Object.keys(resolveTheme(null, 'light')).sort();
    for (const id of PRESET_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        expect(Object.keys(resolveTheme(baseConfig(id), mode)).sort()).toEqual(keys);
      }
    }
  });

  it('preset surfaces match the contracts validation surfaces', () => {
    for (const id of PRESET_IDS) {
      expect(PRESETS[id].light.surface).toBe(PRESET_SURFACES[id].light);
      expect(PRESETS[id].dark.surface).toBe(PRESET_SURFACES[id].dark);
    }
  });

  it('every preset ink clears 4.5:1 on its own surface, both modes', () => {
    for (const id of PRESET_IDS) {
      for (const mode of ['light', 'dark'] as const) {
        const p = PRESETS[id][mode];
        expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.muted, p.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('an accent override that cannot serve as text falls back to the preset accent text', () => {
    const config = {
      ...baseConfig('editorial'),
      overrides: { accent: '#b91c1c' },
    };
    const vars = resolveTheme(config, 'dark');
    // #b91c1c on the editorial dark surface is under 4.5:1 as text; the
    // resolved text accent must be readable regardless.
    const surface = PRESETS.editorial.dark.surface;
    expect(contrastRatio(vars['--mp-primary-text'], surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('radius override changes the radius vars', () => {
    const vars = resolveTheme({ ...baseConfig('artisan'), overrides: { radiusScale: 'sharp' } }, 'light');
    expect(vars['--mp-radius-md']).toBe('4px');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @marketplace/web test -- resolve` → FAIL.

- [ ] **Step 3: Implement presets.ts.** Full palettes — surfaces MUST equal `PRESET_SURFACES` (the test pins it). Palette values below were chosen alongside the approved mockups; verify each ink/muted clears 4.5:1 on its surfaces via the Step 1 test and nudge darker/lighter if one misses:

```ts
import type { FontPairing, PresetId, RadiusScale } from '@marketplace/contracts';

export interface PresetPalette {
  primary: string; primaryHover: string; primaryDeep: string;
  ink: string; inkSoft: string; muted: string;
  line: string; lineStrong: string;
  surface: string; surfaceRaised: string; surfaceSunken: string;
  success: string; warning: string; danger: string;
}

export const FONT_STACKS: Record<FontPairing, { heading: string; body: string }> = {
  inter: {
    heading: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  fraunces: {
    heading: 'var(--font-fraunces), Georgia, serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  playfair: {
    heading: 'var(--font-playfair), Georgia, serif',
    body: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
  },
  nunito: {
    heading: 'var(--font-nunito), ui-rounded, ui-sans-serif, sans-serif',
    body: 'var(--font-nunito), ui-rounded, ui-sans-serif, sans-serif',
  },
};

export const RADIUS_VALUES: Record<RadiusScale, { sm: number; md: number; lg: number; xl: number }> = {
  sharp: { sm: 2, md: 4, lg: 6, xl: 8 },
  soft: { sm: 6, md: 10, lg: 14, xl: 20 },   // today's values in tokens.ts
  round: { sm: 10, md: 14, lg: 20, xl: 28 },
};

export interface Preset {
  id: PresetId;
  light: PresetPalette;
  dark: PresetPalette;
  accentText: { light: string; dark: string };
  heroBg: { light: string; dark: string };
  defaultRadius: RadiusScale;
  defaultFontPairing: FontPairing;
}

export const PRESETS: Record<PresetId, Preset> = {
  artisan: {
    id: 'artisan',
    light: {
      primary: '#a34c26', primaryHover: '#8a3f1f', primaryDeep: '#6f3319',
      ink: '#3d2f24', inkSoft: '#5c4a3a', muted: '#77614d',
      line: '#e6dcc9', lineStrong: '#d4c5a9',
      surface: '#faf6ef', surfaceRaised: '#ffffff', surfaceSunken: '#f3ead9',
      success: '#3f6d3a', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#a34c26', primaryHover: '#c05f33', primaryDeep: '#8a3f1f',
      ink: '#efe6da', inkSoft: '#d4c5b2', muted: '#a8937c',
      line: '#332a21', lineStrong: '#463a2d',
      surface: '#171310', surfaceRaised: '#211b16', surfaceSunken: '#1b1612',
      success: '#7fb377', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#a34c26', dark: '#e08a5e' },
    heroBg: {
      light: 'linear-gradient(120deg, #f3ead9 0%, #faf6ef 100%)',
      dark: 'linear-gradient(120deg, #211b16 0%, #171310 100%)',
    },
    defaultRadius: 'sharp',
    defaultFontPairing: 'fraunces',
  },
  tech: {
    id: 'tech',
    light: {
      primary: '#2f5fe0', primaryHover: '#274fc0', primaryDeep: '#1f3f9a',
      ink: '#101828', inkSoft: '#2c3a51', muted: '#586a83',
      line: '#dde4ef', lineStrong: '#c4cfe0',
      surface: '#f5f7fb', surfaceRaised: '#ffffff', surfaceSunken: '#eaeef7',
      success: '#0f766e', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#2f5fe0', primaryHover: '#4f7cff', primaryDeep: '#274fc0',
      ink: '#e8edf5', inkSoft: '#c0cadb', muted: '#8b98ad',
      line: '#1c2436', lineStrong: '#2a3550',
      surface: '#0a0e17', surfaceRaised: '#101828', surfaceSunken: '#0d1220',
      success: '#2dd4bf', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#2f5fe0', dark: '#7ea1ff' },
    heroBg: {
      light: 'radial-gradient(90% 130% at 85% 0%, rgb(47 95 224 / 12%) 0%, transparent 55%), linear-gradient(135deg, #eaeef7 0%, #f5f7fb 100%)',
      dark: 'radial-gradient(90% 130% at 85% 0%, rgb(79 124 255 / 22%) 0%, transparent 55%), #0a0e17',
    },
    defaultRadius: 'soft',
    defaultFontPairing: 'inter',
  },
  editorial: {
    id: 'editorial',
    light: {
      primary: '#111111', primaryHover: '#2b2b2b', primaryDeep: '#000000',
      ink: '#111111', inkSoft: '#3c3c3c', muted: '#5f5f5f',
      line: '#e4e2de', lineStrong: '#111111',
      surface: '#ffffff', surfaceRaised: '#ffffff', surfaceSunken: '#f5f4f2',
      success: '#1f5f3f', warning: '#8a5a09', danger: '#a11212',
    },
    dark: {
      primary: '#111111', primaryHover: '#f0efec', primaryDeep: '#ffffff',
      ink: '#f0efec', inkSoft: '#cfcdc8', muted: '#a3a19b',
      line: '#2b2b2b', lineStrong: '#f0efec',
      surface: '#101010', surfaceRaised: '#1a1a1a', surfaceSunken: '#141414',
      success: '#79c8a0', warning: '#e0a63a', danger: '#f08a8a',
    },
    accentText: { light: '#111111', dark: '#f0efec' },
    heroBg: { light: '#f5f4f2', dark: '#141414' },
    defaultRadius: 'sharp',
    defaultFontPairing: 'playfair',
  },
  market: {
    id: 'market',
    light: {
      primary: '#c05f22', primaryHover: '#a34e1b', primaryDeep: '#864016',
      ink: '#2d3a26', inkSoft: '#48573e', muted: '#5d6d52',
      line: '#e3ecd9', lineStrong: '#cadbb8',
      surface: '#fffdf7', surfaceRaised: '#ffffff', surfaceSunken: '#f2f7e9',
      success: '#3f6d3a', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#c05f22', primaryHover: '#e07b39', primaryDeep: '#a34e1b',
      ink: '#eaf2df', inkSoft: '#cdd9be', muted: '#9cab8a',
      line: '#242c1c', lineStrong: '#333e28',
      surface: '#12160e', surfaceRaised: '#1a2013', surfaceSunken: '#161b10',
      success: '#8fc784', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#a34e1b', dark: '#eda05f' },
    heroBg: {
      light: 'linear-gradient(120deg, #eaf4e2 0%, #fffdf7 100%)',
      dark: 'linear-gradient(120deg, #1a2013 0%, #12160e 100%)',
    },
    defaultRadius: 'round',
    defaultFontPairing: 'nunito',
  },
  studio: {
    id: 'studio',
    light: {
      primary: '#5f6852', primaryHover: '#4d543f', primaryDeep: '#3d4433',
      ink: '#42403c', inkSoft: '#615e57', muted: '#71706a',
      line: '#e5e2db', lineStrong: '#d1ccc0',
      surface: '#f6f5f3', surfaceRaised: '#ffffff', surfaceSunken: '#edeae4',
      success: '#5f6852', warning: '#b45309', danger: '#b91c1c',
    },
    dark: {
      primary: '#5f6852', primaryHover: '#7d8471', primaryDeep: '#4d543f',
      ink: '#e9e7e1', inkSoft: '#cdc9bf', muted: '#a09a8d',
      line: '#2a2822', lineStrong: '#3a372f',
      surface: '#161512', surfaceRaised: '#201e1a', surfaceSunken: '#1a1915',
      success: '#a3ad92', warning: '#f59e0b', danger: '#f87171',
    },
    accentText: { light: '#4d543f', dark: '#b3bda0' },
    heroBg: {
      light: 'linear-gradient(150deg, #e9e5de 0%, #f6f5f3 100%)',
      dark: 'linear-gradient(150deg, #201e1a 0%, #161512 100%)',
    },
    defaultRadius: 'soft',
    defaultFontPairing: 'inter',
  },
};
```

- [ ] **Step 4: Implement resolve.ts:**

```ts
import { contrastRatio, type StorefrontConfig } from '@marketplace/contracts';
import { cssVars, type Mode } from './tokens';
import { FONT_STACKS, PRESETS, RADIUS_VALUES } from './presets';

const DEFAULT_FONTS = FONT_STACKS.inter;

/**
 * One function from tenant choice to CSS variables. Null config = today's
 * default vars exactly (plus the two font vars every path now emits), so a
 * tenant that never ran the wizard renders as before.
 */
export function resolveTheme(config: StorefrontConfig | null, mode: Mode): Record<string, string> {
  const base = cssVars(mode);
  if (!config) {
    return { ...base, '--mp-font-heading': DEFAULT_FONTS.heading, '--mp-font-body': DEFAULT_FONTS.body };
  }

  const preset = PRESETS[config.presetId];
  const c = preset[mode];
  const accent = config.overrides.accent ?? c.primary;
  // Accent as text only when it reads on this mode's surface; otherwise the
  // preset's own pre-checked text accent. The contracts fill rule already
  // guarantees white-on-accent for buttons.
  const accentText =
    contrastRatio(accent, c.surface) >= 4.5 ? accent : preset.accentText[mode];
  const radius = RADIUS_VALUES[config.overrides.radiusScale ?? preset.defaultRadius];
  const fonts = FONT_STACKS[config.overrides.fontPairing ?? preset.defaultFontPairing];

  return {
    ...base,
    '--mp-primary': accent,
    '--mp-primary-hover': c.primaryHover,
    '--mp-primary-deep': c.primaryDeep,
    '--mp-primary-text': accentText,
    '--mp-primary-text-hover': accentText,
    '--mp-primary-wash': `${accent}1a`,
    '--mp-ink': c.ink,
    '--mp-ink-soft': c.inkSoft,
    '--mp-muted': c.muted,
    '--mp-line': c.line,
    '--mp-line-strong': c.lineStrong,
    '--mp-surface': c.surface,
    '--mp-surface-raised': c.surfaceRaised,
    '--mp-surface-sunken': c.surfaceSunken,
    '--mp-success': c.success,
    '--mp-warning': c.warning,
    '--mp-danger': c.danger,
    '--mp-hero-bg': preset.heroBg[mode],
    '--mp-hero-ink': c.ink,
    '--mp-hero-muted': c.muted,
    '--mp-hero-eyebrow': accentText,
    '--mp-radius-sm': `${radius.sm}px`,
    '--mp-radius-md': `${radius.md}px`,
    '--mp-radius-lg': `${radius.lg}px`,
    '--mp-radius-xl': `${radius.xl}px`,
    '--mp-font-heading': fonts.heading,
    '--mp-font-body': fonts.body,
  };
}

/** What the shop shell hands its nested antd ConfigProvider, null = leave default. */
export function resolveAntdAccent(config: StorefrontConfig | null, mode: Mode): string | null {
  if (!config) return null;
  return config.overrides.accent ?? PRESETS[config.presetId][mode].primary;
}
```

- [ ] **Step 5: Fonts in the root layout.** In `apps/web/app/layout.tsx`, beside the existing Inter setup, add `Fraunces`, `Playfair_Display` and `Nunito` from `next/font/google` with css variables `--font-fraunces`, `--font-playfair`, `--font-nunito`, and add their `.variable` classes to the same element that carries Inter's.

- [ ] **Step 6: Run** `pnpm --filter @marketplace/web test -- resolve` → PASS, then `pnpm --filter @marketplace/web test` (no regressions — `tokens.test.ts` and `theme-context.test.tsx` must stay green), then `pnpm --filter @marketplace/web build` → clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/theme/presets.ts apps/web/lib/theme/resolve.ts apps/web/lib/theme/resolve.test.ts apps/web/app/layout.tsx
git commit -m "feat(web): five storefront presets and resolveTheme with contrast fallbacks"
```

---

### Task 6: Web API client and shop-shell theme application

**Files:**
- Create: `apps/web/lib/api/storefront.ts`
- Create: `apps/web/lib/api/storefront.test.ts`
- Modify: `apps/web/app/(shop)/layout.tsx`

**Interfaces:**
- Consumes: `request` from `./http`, contracts schemas, `resolveTheme`/`resolveAntdAccent` (Task 5), `useTheme` from `../../lib/theme/theme-context`.
- Produces:
  ```ts
  // lib/api/storefront.ts
  export const getPublishedStorefront = () => request('/storefront', { schema: StorefrontConfigSchema.nullable() });
  export const getStorefrontDraft = () => request('/storefront/draft', { schema: StorefrontDraftResponseSchema });
  export const putStorefrontDraft = (body: StorefrontConfig) => request('/storefront/draft', { method: 'PUT', body, schema: StorefrontConfigSchema });
  export const publishStorefront = () => request('/storefront/publish', { method: 'POST', schema: StorefrontConfigSchema });
  export const getOnboardingFlag = () => request('/storefront/onboarding', { schema: OnboardingFlagSchema });
  export const putOnboardingFlag = (body: OnboardingFlag) => request('/storefront/onboarding', { method: 'PUT', body, schema: OnboardingFlagSchema });
  ```
- Produces for later tasks: the shop shell renders `<div className="mp-shop" style={tenantVarsAsCSSProperties}>` and nests `<ConfigProvider theme={...}>` only when a published config exists.

- [ ] **Step 1: API client test** — mirror `apps/web/lib/api/messages.test.ts`'s fetch-mocking style; assert `getPublishedStorefront` parses `null` and a config, and `putStorefrontDraft` sends `PUT` with the JSON body. Run, watch fail, implement the client above, watch pass.

- [ ] **Step 2: Shop shell.** In `apps/web/app/(shop)/layout.tsx`, extend the existing gate:

```tsx
const [config, setConfig] = useState<StorefrontConfig | null>(null);
const [configReady, setConfigReady] = useState(false);
const { mode } = useTheme();

useEffect(() => {
  if (!ready || !principal) return;
  getPublishedStorefront()
    .then(setConfig)
    // A failed fetch renders the default theme; the shop must not be down
    // because theming is.
    .catch(() => setConfig(null))
    .finally(() => setConfigReady(true));
}, [ready, principal]);

if (!ready || !principal || !configReady) return null;

const vars = config ? (resolveTheme(config, mode) as React.CSSProperties) : undefined;
const accent = resolveAntdAccent(config, mode);

const shell = (
  <div className="mp-shop" style={vars}>
    …existing children unchanged…
  </div>
);
return accent ? (
  <ConfigProvider theme={{ token: { colorPrimary: accent, colorLink: vars!['--mp-primary-text' as never] } }}>
    {shell}
  </ConfigProvider>
) : shell;
```

CSS-variable inline styles need the `Record<string, string>` cast shown; keep it in one place. **The cockpit is untouched** — only this file applies tenant vars.

- [ ] **Step 3: Existing tests still green** — `pnpm --filter @marketplace/web test` (shop page tests mock APIs; add the `getPublishedStorefront` mock to any shop-layout test that now fetches it — follow the failure list). Then `pnpm --filter @marketplace/web build`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/api/storefront.ts apps/web/lib/api/storefront.test.ts "apps/web/app/(shop)/layout.tsx"
git commit -m "feat(web): storefront API client; shop shell applies the tenant theme"
```

---

### Task 7: About page and banner rendering on the storefront

**Files:**
- Create: `apps/web/components/storefront-banner.tsx`
- Create: `apps/web/components/about-sections.tsx`
- Create: `apps/web/app/(shop)/about/page.tsx`
- Create: `apps/web/app/(shop)/about/page.test.tsx`
- Modify: `apps/web/app/(shop)/products/page.tsx` (hero slot swap)
- Modify: `apps/web/components/shop-header.tsx` (add an About nav link when a published config exists — read the file first and follow its nav-item pattern)

**Interfaces:**
- Consumes: `Banner`, `AboutPage`, `StorefrontConfig` from contracts; `getPublishedStorefront` (Task 6).
- Produces (shared with the Task 12 preview — that is the point of extracting them):
  ```tsx
  export function StorefrontBanner({ banner }: { banner: Banner }): JSX.Element
  export function AboutSections({ about }: { about: AboutPage }): JSX.Element
  ```

- [ ] **Step 1: Components.** `StorefrontBanner`: a section styled entirely from `--mp-*` vars — `art.kind === 'css'` paints `var(--mp-hero-bg)`; `upload`/`generated` set `backgroundImage: url(imageUrl)` with a `linear-gradient(rgb(0 0 0 / 35%), rgb(0 0 0 / 35%))` scrim under white text so any photo stays readable. Headline, subline, CTA link (`className` reusing the existing hero button classes in `apps/web/app/styles/pages.css` — read the current hero markup in `products/page.tsx` and match its class names). `AboutSections`: `<h1>{title}</h1>` then a `<section>` per entry, fonts from `var(--mp-font-heading)`/`var(--mp-font-body)`.

- [ ] **Step 2: About page + test.** `about/page.tsx` fetches the published config; no config or no `about` → render a quiet empty state ("This shop hasn't written its story yet."). Test with the API mocked both ways (mirror an existing `(shop)` page test's mocking setup, e.g. `products/page.test.tsx`).

- [ ] **Step 3: Hero swap.** In `products/page.tsx`: when the published config has a `hero` banner, render `<StorefrontBanner banner={hero} />` in place of the hardcoded hero block; otherwise the existing hero stays. `mid`/`footer` banners render after the product grid and before the page end respectively (same page, same conditional pattern). Update `products/page.test.tsx` mocks accordingly.

- [ ] **Step 4: Run** `pnpm --filter @marketplace/web test` → PASS; `pnpm --filter @marketplace/web build` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/storefront-banner.tsx apps/web/components/about-sections.tsx "apps/web/app/(shop)/about" "apps/web/app/(shop)/products/page.tsx" "apps/web/app/(shop)/products/page.test.tsx" apps/web/components/shop-header.tsx
git commit -m "feat(web): about page and tenant banners on the storefront"
```

---

### Task 8: Agents — thread kinds and engine-client write

**Files:**
- Modify: `apps/agents/src/threads/thread-registry.service.ts`
- Modify: `apps/agents/src/threads/thread-registry.service.int-test.ts`
- Modify: `apps/agents/src/engine-client/engine.client.ts`
- Modify: `apps/agents/src/chat/chat.gateway.ts`

**Interfaces:**
- Consumes: `ThreadKind`, `ThreadStartSchema` from contracts (Task 2).
- Produces:
  ```ts
  // ThreadRegistryService
  create(principal: TenantPrincipal, kind: ThreadKind): Promise<string>
  getKind(threadId: string, principal: TenantPrincipal): Promise<ThreadKind>  // asserts ownership; absent kind on an old record reads as 'schema'
  // EngineClient
  putStorefrontDraft(config: StorefrontConfig, token: string): Promise<void>
  ```
- Gateway behaviour later tasks rely on: `thread.start` accepts `{ kind }` (absent body → `'schema'`); `message`/`thread.resume` route by kind to `GraphService` or `OnboardingGraphService` (Task 11 injects it — in THIS task, route `'onboarding'` to a thrown `ProblemException('invalid-event-payload', 422, 'Onboarding threads are not available yet')` placeholder the Task 11 diff replaces); `confirm`/`reject` on an onboarding thread → 422 problem `'invalid-event-payload'` ("onboarding threads accept only messages").

- [ ] **Step 1: Registry.** `ThreadOwner` gains `kind: ThreadKind`; `create` writes it; add `getKind` (calls the same parse/assert path as `assertOwned` and returns `owner.kind ?? 'schema'`). Extend the int-test: create with `'onboarding'`, `getKind` returns it; a pre-kind record (seed Redis by hand with no `kind`) reads `'schema'`; `getKind` for another tenant's thread → 404.

- [ ] **Step 2: Engine client.** Generalize the private `get` into `send(method, path, token, body?)` (keep `get` delegating to it — every existing error branch unchanged), and add:

```ts
async putStorefrontDraft(config: StorefrontConfig, token: string): Promise<void> {
  await this.send('PUT', '/api/v1/storefront/draft', token, config);
}
```

`send` sets `content-type: application/json` and `body: JSON.stringify(body)` when a body is given; a 400 response maps to `ProblemException('invalid-request', 400, 'Engine rejected the payload', path)` — a new branch above the existing `!res.ok` catch-all. Confirm the engine path prefix by looking at how `getSchema`'s `/api/v1/...` path is built — reuse exactly that prefix shape.

- [ ] **Step 3: Gateway.** `onThreadStart` parses `ThreadStartSchema` from `body ?? {}` and passes `kind` to `create`; store nothing else. `onMessage`/`onThreadResume`/`onConfirm`/`onReject` first call `this.threads.getKind(threadId, data.principal)` (replaces the bare `touch` — add a `touchWithKind` or call `touch` then `getKind`; one Redis round-trip extra is fine) and branch as described in Interfaces.

- [ ] **Step 4: Run** — `pnpm --filter @marketplace/agents test` (unit) and, with the stack up, the int-tests: `pnpm --filter @marketplace/agents test -- thread-registry` → PASS. `nest build` via `pnpm --filter @marketplace/agents build` → clean.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/threads apps/agents/src/engine-client apps/agents/src/chat
git commit -m "feat(agents): thread kinds, gateway routing, engine draft write"
```

---

### Task 9: Onboarding state, prompts, profile + theme nodes

**Files:**
- Create: `apps/agents/src/onboarding/state.ts`
- Create: `apps/agents/src/onboarding/state.test.ts`
- Create: `apps/agents/src/onboarding/prompts.ts`
- Create: `apps/agents/src/onboarding/nodes/profile-check.node.ts`
- Create: `apps/agents/src/onboarding/nodes/profile-check.node.test.ts`
- Create: `apps/agents/src/onboarding/nodes/propose-theme.node.ts`
- Create: `apps/agents/src/onboarding/nodes/propose-theme.node.test.ts`

**Interfaces:**
- Consumes: `LlmProvider` (`llm.structured({ system, messages, schema, name })` — as `requirement-check.node.ts` uses it), `BusinessProfile`, `ThemeOverrides`, `PresetId`, `OnboardingPhase` from contracts.
- Produces:
  ```ts
  // state.ts — mirrors ../graph/state.ts structure exactly
  export const ONBOARDING_FIELD_DEFAULTS = {
    phase: 'gathering' as OnboardingPhase,
    profile: null as BusinessProfile | null,
    presetId: null as PresetId | null,
    overrides: null as ThemeOverrides | null,
    about: null as AboutPage | null,
    banners: null as Banner[] | null,
    draft: null as StorefrontConfig | null,
    generateAttempts: 0,
  };
  export const OnboardingAnnotation = Annotation.Root({ ...MessagesAnnotation.spec, /* replace-channels from the defaults, same `replace` helper pattern as graph/state.ts */ });
  export type OnboardingState = typeof OnboardingAnnotation.State;
  export const defaultOnboardingState: OnboardingState;
  export function toOnboardingSnapshot(threadId: string, state: OnboardingState): OnboardingSnapshot;
  // node factories
  export function makeProfileCheckNode(deps: { llm: LlmProvider }): (state) => Promise<Partial<OnboardingState>>
  export function makeProposeThemeNode(deps: { llm: LlmProvider; maxAttempts: number }): (state) => Promise<Partial<OnboardingState>>
  ```
  `state.test.ts` replicates the channel-keys sync test from `graph/state.test.ts` for the new annotation.

- [ ] **Step 1: prompts.ts** — actual text:

```ts
export const PROFILE_SYSTEM = `You are onboarding the owner of a new online store.
Decide whether the conversation so far tells you all four of: what kind of business this is,
the business name, the tone the owner wants (e.g. warm, premium, playful), and who the
customers are. If anything is missing, ask ONE short friendly question for the most
important missing piece. Never invent values the owner has not given or clearly implied.`;

export const THEME_SYSTEM = `You choose a visual direction for the store described below.
Pick the preset that best fits the business:
- artisan: warm cream and terracotta, serif type. Makers, crafts, small-batch goods.
- tech: dark surfaces, electric blue, tight sans. Electronics, gaming, gadgets.
- editorial: black on white, italic serif, no rounding. Fashion, jewellery, premium.
- market: leaf green and orange, rounded and friendly. Grocers, bakeries, cafés, florists.
- studio: warm greys and sage, calm and soft. Wellness, studios, bookable services.
Optionally suggest an accent colour as #rrggbb only if the business has a strong colour
identity; it must be dark enough for white button text. Optionally pick radiusScale
(sharp | soft | round) and fontPairing (inter | fraunces | playfair | nunito) when the
tone clearly calls for it; otherwise leave them out and the preset's defaults apply.`;

export const CONTENT_SYSTEM = `You write storefront copy for the business described below, in
the owner's tone. Produce an About page (a title and 2-4 short sections: who they are, what
they make or do, why it's worth buying) and up to three banners (hero required; mid and
footer only when there is something real to say). Banner headlines are punchy (under 60
characters); sublines one sentence. CTA hrefs must be one of: /products, /events, /about.
If the conversation contains feedback on an earlier draft, apply it and keep everything
the owner did not complain about.`;
```

- [ ] **Step 2: profile-check node** — test first with a stub `llm` (`{ structured: vi.fn() }` … the agents package uses jest: `jest.fn()`), asserting: (a) LLM says incomplete → returns `phase: 'gathering'` and an `AIMessage` question; (b) complete → returns `phase: 'generating'` and the parsed profile; (c) a state that already has a profile short-circuits to `{ phase: 'generating' }` without calling the LLM. Then implement:

```ts
const ProfileResultSchema = z.object({
  complete: z.boolean(),
  profile: z
    .object({ kind: z.string(), name: z.string(), tone: z.string(), audience: z.string() })
    .nullable(),
  question: z.string(),
});

export function makeProfileCheckNode(deps: { llm: LlmProvider }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    if (state.profile) return { phase: 'generating' };
    const result = await deps.llm.structured({
      system: PROFILE_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: ProfileResultSchema,
      name: 'business_profile',
    });
    const parsed = result.complete && result.profile
      ? BusinessProfileSchema.safeParse(result.profile)
      : null;
    if (parsed?.success) {
      return { phase: 'generating', profile: parsed.data };
    }
    const question = result.question.trim() || 'What kind of business are you setting up?';
    return { phase: 'gathering', messages: [new AIMessage(question)] };
  };
}
```

(`toChatMessages` is exported from `../graph/state` — import it rather than duplicating.)

- [ ] **Step 3: propose-theme node** — test: (a) valid LLM pick lands in state; (b) invalid presetId retries up to `maxAttempts` then throws `ProblemException('internal-error', …)`; (c) low-contrast accent is dropped (not fatal — overrides parse strips it via `safeParse` fallback to `{}`). Implement:

```ts
const ThemeResultSchema = z.object({
  presetId: z.string(),
  accent: z.string().optional(),
  radiusScale: z.string().optional(),
  fontPairing: z.string().optional(),
});

export function makeProposeThemeNode(deps: { llm: LlmProvider; maxAttempts: number }) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    const profileText = JSON.stringify(state.profile);
    for (let attempt = 0; attempt < deps.maxAttempts; attempt++) {
      const result = await deps.llm.structured({
        system: `${THEME_SYSTEM}\n\nBusiness: ${profileText}`,
        messages: toChatMessages(state.messages),
        schema: ThemeResultSchema,
        name: 'theme_choice',
      });
      const preset = PresetIdSchema.safeParse(result.presetId);
      if (!preset.success) continue;
      const overrides = ThemeOverridesSchema.safeParse({
        ...(result.accent ? { accent: result.accent } : {}),
        ...(result.radiusScale ? { radiusScale: result.radiusScale } : {}),
        ...(result.fontPairing ? { fontPairing: result.fontPairing } : {}),
      });
      return {
        presetId: preset.data,
        // A malformed override set costs the tuning, never the run.
        overrides: overrides.success ? overrides.data : {},
      };
    }
    throw new ProblemException('internal-error', 500, 'Internal Server Error', 'theme proposal never named a valid preset');
  };
}
```

- [ ] **Step 4: Run** `pnpm --filter @marketplace/agents test -- onboarding` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/onboarding
git commit -m "feat(agents): onboarding state, prompts, profile and theme nodes"
```

---

### Task 10: Content, assemble and dispatch nodes

**Files:**
- Create: `apps/agents/src/onboarding/nodes/draft-content.node.ts` + `.test.ts`
- Create: `apps/agents/src/onboarding/nodes/assemble-draft.node.ts` + `.test.ts`
- Create: `apps/agents/src/onboarding/nodes/dispatch-draft.node.ts` + `.test.ts`

**Interfaces:**
- Consumes: Task 9's state and prompts; `EngineClient.putStorefrontDraft` (Task 8); `RunContext` from `../graph/context`.
- Produces:
  ```ts
  makeDraftContentNode(deps: { llm: LlmProvider; maxAttempts: number })
  makeAssembleDraftNode()                                   // pure
  makeDispatchDraftNode(deps: { engine: EngineClient }, ctx: RunContext)
  ```

- [ ] **Step 1: draft-content node.** LLM result schema:

```ts
const ContentResultSchema = z.object({
  about: z.object({
    title: z.string(),
    sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  }),
  banners: z.array(
    z.object({
      slot: z.string(),
      headline: z.string(),
      subline: z.string(),
      ctaLabel: z.string(),
      ctaHref: z.string(),
    }),
  ),
});
```

Map each banner to a contracts `Banner` with `id: \`${slot}-1\``, `art: { kind: 'css' }`, `cta.href` coerced onto the allowlist (`/products`, `/events`, `/about`; anything else becomes `/products`). Validate the mapped `about` with `AboutPageSchema.safeParse` and each banner with `BannerSchema.safeParse`; drop banners that fail, retry the whole call (bounded by `maxAttempts`) if `about` fails or no hero banner survives; exhausting attempts throws the same `internal-error` problem as propose-theme. **Preserve existing art on regeneration:** if `state.banners` already holds a banner for a slot whose `art.kind` is `upload` or `generated`, keep that art object on the regenerated banner for the slot — feedback on copy must not throw away the owner's image. Tests cover: happy path, `cta.href` coercion, art preservation, no-hero retry.

- [ ] **Step 2: assemble node** — pure:

```ts
export function makeAssembleDraftNode() {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    const parsed = StorefrontConfigSchema.safeParse({
      presetId: state.presetId,
      overrides: state.overrides ?? {},
      about: state.about,
      banners: state.banners ?? [],
      businessProfile: state.profile,
    });
    if (!parsed.success) {
      // Upstream nodes validated their slices; reaching here is a bug, and a
      // typed 500 beats a stored corrupt draft.
      throw new ProblemException('internal-error', 500, 'Internal Server Error', 'assembled draft failed contract validation');
    }
    return { draft: parsed.data };
  };
}
```

Test: assembles the reference slices; throws on a missing profile.

- [ ] **Step 3: dispatch node:**

```ts
export function makeDispatchDraftNode(deps: { engine: EngineClient }, ctx: RunContext) {
  return async (state: OnboardingState): Promise<Partial<OnboardingState>> => {
    if (!state.draft) {
      throw new ProblemException('internal-error', 500, 'Internal Server Error', 'dispatch requires an assembled draft');
    }
    await deps.engine.putStorefrontDraft(state.draft, ctx.authToken);
    return {
      phase: 'drafted',
      messages: [
        new AIMessage(
          "I've updated your draft store — the preview should refresh. Tell me what to change, or hit Publish when it feels right.",
        ),
      ],
    };
  };
}
```

Test with a stubbed engine client: PUT called with the draft and the ctx token; phase lands `drafted`; missing draft throws.

- [ ] **Step 4: Run** `pnpm --filter @marketplace/agents test -- onboarding` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/onboarding
git commit -m "feat(agents): onboarding content, assemble and dispatch nodes"
```

---

### Task 11: Onboarding graph service and gateway wiring

**Files:**
- Create: `apps/agents/src/onboarding/onboarding-graph.service.ts`
- Create: `apps/agents/src/onboarding/onboarding.module.ts`
- Create: `apps/agents/src/onboarding/onboarding-graph.service.int-test.ts`
- Modify: `apps/agents/src/app.module.ts` (import `OnboardingModule`)
- Modify: `apps/agents/src/chat/chat.gateway.ts` (replace the Task 8 placeholder branch with real routing)

**Interfaces:**
- Consumes: everything from Tasks 9–10, `CHECKPOINTER`/`RedisSaver`, `ENV` (`DRAFT_MAX_ATTEMPTS` reused as the generation attempt bound), `LLM`, `EngineClient` — mirror `GraphService`'s constructor exactly.
- Produces:
  ```ts
  class OnboardingGraphService {
    run(input: { threadId: string; ctx: Omit<RunContext, 'threadId'>; content: string }): Promise<OnboardingSnapshot>
    snapshot(threadId: string): Promise<OnboardingSnapshot>
  }
  ```

- [ ] **Step 1: Graph build** — per-run compile like `GraphService.build`:

```ts
private build(ctx: RunContext) {
  const graph = new StateGraph(OnboardingAnnotation)
    .addNode('profileCheck', makeProfileCheckNode({ llm: this.llm }))
    .addNode('proposeTheme', makeProposeThemeNode({ llm: this.llm, maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }))
    .addNode('draftContent', makeDraftContentNode({ llm: this.llm, maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }))
    .addNode('assembleDraft', makeAssembleDraftNode())
    .addNode('dispatchDraft', makeDispatchDraftNode({ engine: this.engine }, ctx))
    // A message to a drafted thread is feedback: regenerate with history.
    // A message to a fresh/gathering thread starts with the profile.
    .addConditionalEdges(START, (state: OnboardingState) =>
      state.phase === 'drafted' ? 'proposeTheme' : 'profileCheck',
    )
    .addConditionalEdges('profileCheck', (state: OnboardingState) =>
      state.phase === 'gathering' ? END : 'proposeTheme',
    )
    .addEdge('proposeTheme', 'draftContent')
    .addEdge('draftContent', 'assembleDraft')
    .addEdge('assembleDraft', 'dispatchDraft')
    .addEdge('dispatchDraft', END);
  return graph.compile({ checkpointer: this.checkpointer });
}
```

`run`/`snapshot` copy `GraphService`'s shape (invoke with `HumanMessage(content)`, thread-scoped config, `toOnboardingSnapshot` on the way out; a never-run thread snapshots from `defaultOnboardingState`). Read `graph.service.ts`'s `run` and `snapshot` bodies and transliterate — same checkpointer semantics, no `pendingAction` (messages are the only action).

- [ ] **Step 2: Gateway routing.** Replace the Task 8 placeholder: `kind === 'onboarding'` routes `message` → `this.onboardingGraph.run(...)`, `thread.resume` → `this.onboardingGraph.snapshot(threadId)`; widen `handle`'s callback type to `Promise<AgentSnapshot>`.

- [ ] **Step 3: Int-test** (needs the stack's Redis + the scripted LLM provider — mirror `graph.service.int-test.ts`'s harness): script the LLM so message 1 leaves an incomplete profile (asserts a question comes back, phase `gathering`), message 2 completes it and yields theme + content (asserts phase `drafted`, `draft.presetId` correct, engine client stub received the PUT), message 3 is feedback (asserts a second PUT with changed copy).

- [ ] **Step 4: Run** — unit: `pnpm --filter @marketplace/agents test`; int (stack up): `pnpm --filter @marketplace/agents test -- onboarding-graph`; `pnpm --filter @marketplace/agents build` → all clean.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/src/onboarding apps/agents/src/app.module.ts apps/agents/src/chat/chat.gateway.ts
git commit -m "feat(agents): onboarding graph wired through the chat gateway"
```

---

### Task 12: Wizard page — chat, preview, publish

**Files:**
- Create: `apps/web/app/(admin)/admin/onboarding/page.tsx`
- Create: `apps/web/app/(admin)/admin/onboarding/page.test.tsx`
- Create: `apps/web/app/(admin)/admin/onboarding/preview-pane.tsx`

**Interfaces:**
- Consumes: the socket client the existing `(admin)/admin/chat/page.tsx` uses — **read that page and its imports first** and reuse its connection/emit/subscribe code with `thread.start` payload `{ kind: 'onboarding' }` and `OnboardingSnapshotSchema` parsing on `state` events; `resolveTheme` (Task 5); `StorefrontBanner`, `AboutSections` (Task 7); `getStorefrontDraft`, `publishStorefront`, `putOnboardingFlag` (Task 6).
- Produces: `/admin/onboarding` — chat pane left, preview right, tabs (Storefront / About / Banners), Publish (antd `Popconfirm`, disabled until a draft exists), "Skip for now" (sets `{ dismissed: true }`, routes to `/admin`).

- [ ] **Step 1: Preview pane.** A client component taking `{ draft: StorefrontConfig | null }`:

```tsx
export function PreviewPane({ draft }: { draft: StorefrontConfig | null }) {
  const { mode } = useTheme();
  const [tab, setTab] = useState<'storefront' | 'about' | 'banners'>('storefront');
  if (!draft) {
    return <Empty description="Your store preview appears here as we talk" />;
  }
  const vars = resolveTheme(draft, mode) as React.CSSProperties;
  const hero = draft.banners.find((b) => b.slot === 'hero');
  return (
    <div style={vars} className="mp-onboarding-preview">
      <Segmented value={tab} onChange={setTab} options={['storefront', 'about', 'banners']} />
      {tab === 'storefront' && (
        <div style={{ background: 'var(--mp-surface)' }}>
          {hero && <StorefrontBanner banner={hero} />}
          {/* three placeholder product cards drawn from --mp-* vars, so the
              card treatment (radius, line, raised surface) previews too */}
        </div>
      )}
      {tab === 'about' && <AboutSections about={draft.about} />}
      {tab === 'banners' && draft.banners.map((b) => <StorefrontBanner key={b.id} banner={b} />)}
    </div>
  );
}
```

- [ ] **Step 2: Page.** State: `snapshot` (from socket `state` events), `draft` (refetched via `getStorefrontDraft()` whenever a snapshot arrives with phase `drafted` — the engine copy is the truth the preview renders, not the socket payload). Publish button → `Popconfirm` → `publishStorefront()` → success message + route to `/admin`. Skip → `putOnboardingFlag({ dismissed: true })` → `/admin`.

- [ ] **Step 3: Page test** — socket mocked the way the existing chat page test mocks it (if `chat/page.tsx` has no test, mock the socket module it imports): renders empty state; a `drafted` snapshot triggers the draft refetch and enables Publish; Skip calls `putOnboardingFlag`.

- [ ] **Step 4: Run** `pnpm --filter @marketplace/web test -- onboarding` → PASS; `pnpm --filter @marketplace/web build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/admin/onboarding"
git commit -m "feat(web): onboarding wizard with live draft preview and publish"
```

---

### Task 13: Entry points and inline edits

**Files:**
- Modify: `apps/web/app/(admin)/layout.tsx` (first-login redirect + nav)
- Modify: `apps/web/app/(admin)/admin/settings/page.tsx` ("Store design" link/section)
- Modify: `apps/web/app/(admin)/admin/onboarding/page.tsx` + `preview-pane.tsx` (inline copy edits, banner upload)

**Interfaces:**
- Consumes: `getPublishedStorefront`, `getOnboardingFlag`, `putStorefrontDraft` (Task 6), `uploadProductImage` from `../../lib/api/uploads` (reused for banner photos — same media bucket, same validation).
- Produces: redirect rule — an admin landing anywhere under `(admin)` with `published === null && dismissed === false` is routed once per session to `/admin/onboarding` (guard with a `useRef` so the wizard itself never re-triggers it); Settings gains a "Store design" item linking to `/admin/onboarding`.

- [ ] **Step 1: Redirect** in `(admin)/layout.tsx` — after its existing auth gate resolves an admin principal, fetch both flags in parallel; on `[null, {dismissed:false}]` and not already on `/admin/onboarding`, `router.replace('/admin/onboarding')`. Test alongside the layout's existing tests if it has them; otherwise cover through the Task 15 journey.

- [ ] **Step 2: Inline edits.** In the preview pane: headline/subline/CTA-label and about title/heading/body become click-to-edit (antd `Typography.Text editable` or a small input swap — match how existing admin pages do inline editing if any do; otherwise `Input` on click, save on blur). Each committed edit builds the updated `StorefrontConfig` and calls `putStorefrontDraft`; the response replaces local draft state. Banner slot gets an Upload button: `uploadProductImage(file)` → `putStorefrontDraft` with that banner's `art` set to `{ kind: 'upload', imageUrl }`.

- [ ] **Step 3: Tests** — page test additions: an edit round-trips through `putStorefrontDraft` mock; upload sets the art kind. Run `pnpm --filter @marketplace/web test` → PASS; build → clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(admin)"
git commit -m "feat(web): onboarding entry points, inline draft edits, banner upload"
```

---

### Task 14: Optional ComfyUI banner art

**Files:**
- Create: `apps/engine/src/storefront/image-gen.client.ts`
- Create: `apps/engine/src/storefront/image-gen.client.test.ts`
- Modify: `apps/engine/src/storefront/storefront.service.ts` + `.test.ts` (add `generateBannerArt`)
- Modify: `apps/engine/src/storefront/storefront.controller.ts` (`POST /storefront/banner-art`)
- Modify: `apps/engine/src/storefront/storefront.module.ts` (provide the client when `IMAGE_GEN_URL` is set)
- Modify: `apps/engine/src/config/env.schema.ts` (`IMAGE_GEN_CHECKPOINT: z.string().default('sd_xl_base_1.0.safetensors')`, `IMAGE_GEN_TIMEOUT_MS: z.coerce.number().default(120_000)`)
- Modify: `packages/contracts/src/storefront.ts` (+ test): `BannerArtRequestSchema = z.object({ slot: BannerSlotSchema }).strict()`, `BannerArtResponseSchema = z.object({ imageUrl: z.string().url() }).strict()`
- Modify: `apps/engine/src/common/problem.ts` (add `'image-gen-unavailable'`)
- Modify: wizard (Task 12 files): Generate button per banner slot when `capabilities.imageGen`

**Interfaces:**
- Consumes: the uploads path — read `apps/engine/src/uploads/uploads.service.ts` first and call the same store method the product-image controller calls, with content type `image/png`; the draft's `businessProfile` + the slot's banner copy for the prompt.
- Produces: `ImageGenClient.generate(prompt: string): Promise<Buffer>`; `StorefrontService.generateBannerArt(slot: BannerSlot): Promise<{ imageUrl: string }>` (admin; problems: no draft → `storefront-draft-not-found`; no client wired → `image-gen-unavailable` 503; ComfyUI failure/timeout → `image-gen-unavailable` 503).

- [ ] **Step 1: ComfyUI client.** REST protocol against `IMAGE_GEN_URL`:
  1. `POST {url}/prompt` body `{ prompt: workflow, client_id: randomUUID() }` → `{ prompt_id }`.
  2. Poll `GET {url}/history/{prompt_id}` every 2s until the entry exists with `outputs` (bound total wait by `IMAGE_GEN_TIMEOUT_MS`).
  3. From the SaveImage node's output take `{ filename, subfolder, type }`; `GET {url}/view?filename=…&subfolder=…&type=…` → PNG bytes.

  The workflow is a plain txt2img graph keyed by node id: CheckpointLoaderSimple (`IMAGE_GEN_CHECKPOINT`) → two CLIPTextEncode (positive = the prompt; negative = `"text, watermark, logo, low quality"`) → EmptyLatentImage 1152×512 → KSampler (20 steps, cfg 7, seed from `randomInt`) → VAEDecode → SaveImage. Write it as a function returning the JSON object. Unit-test with mocked `fetch`: happy path returns bytes; a poll that never completes rejects within the timeout; non-200 on `/prompt` rejects. All rejections surface as `ProblemException('image-gen-unavailable', 503, …)`.

- [ ] **Step 2: Service + controller.** `generateBannerArt(slot)`: admin check → load draft (404 problem if absent) → prompt = `` `wide storefront banner photograph for ${profile.kind} named ${profile.name}, ${profile.tone} mood, no text, ${banner.headline}` `` → client.generate → store via uploads service → return `{ imageUrl }`. Controller route `@Post('banner-art')` `@Roles('admin')` with `ZodBody(BannerArtRequestSchema)`. Service tests: unavailable when client absent; prompt built from draft; result URL returned.

- [ ] **Step 3: Wizard button.** Per-slot "Generate image" (only when `capabilities.imageGen`): calls a new `generateBannerArt(slot)` in `lib/api/storefront.ts` (`request('/storefront/banner-art', { method: 'POST', body: { slot }, schema: BannerArtResponseSchema })`), then `putStorefrontDraft` with the slot's art set to `{ kind: 'generated', imageUrl }`. Spinner on the slot while pending; a `ProblemError` shows an antd `message.error` and leaves the art unchanged.

- [ ] **Step 4: Run** — engine unit tests, contracts tests, web tests, both builds → all clean. Optional live check if you set `IMAGE_GEN_URL=http://host.docker.internal:8188` in the engine's compose environment locally — do NOT commit that env line; the committed compose stays unset.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src apps/engine/src apps/web
git commit -m "feat: optional ComfyUI banner art generation behind IMAGE_GEN_URL"
```

---

### Task 15: Journey, screenshots, full verification

**Files:**
- Modify: `apps/web/test/e2e-journeys/run.mjs` (new journeys — read the file first; every journey there follows one helper pattern, copy it)
- Modify: `docs/STATUS.md` (feature entry)
- Create: `docs/STATUS-onboarding.md` (scope, decisions, verification evidence)

- [ ] **Step 1: Journeys** (added to the existing 73):
  1. **Onboarding happy path:** login as the seed admin → expect redirect to `/admin/onboarding` *(if the seed tenant ships with a published config, first `PUT /storefront/onboarding {dismissed:false}` and delete the published item via the engine API — check what the seed writes before assuming)* → send a business description through the chat → wait for the drafted snapshot → assert the preview pane shows the generated headline → Publish via the Popconfirm → land on `/admin` → visit the storefront → assert the hero shows the generated headline and the page carries the preset's `--mp-surface` value → visit `/about` → assert the generated title renders.
  2. **Dismiss path:** fresh state → "Skip for now" → assert `/admin` loads and a reload does NOT redirect back.
  3. **Re-entry:** Settings → Store design → wizard opens with the existing draft.

  The agents container runs the real ollama model in journeys; generation output is nondeterministic, so assert on structure (a hero banner exists, about has ≥1 section), never on exact copy. If journey infrastructure pins the LLM to a scripted mode, use it the way existing agent journeys do — read how the current chat journeys handle this before writing these.

- [ ] **Step 2: Run the journeys** — stack up, `pnpm --filter @marketplace/web e2e:journeys` → 76/76 (or current count + 3).

- [ ] **Step 3: Screenshots — render and look.** For each preset: publish a config for it (engine API directly is fine), screenshot the storefront home, `/about`, and a product page, light AND dark (10+ screenshots). Look at every one for: unreadable text, hero/banner collisions, radius or font that didn't apply, antd components still teal on a non-teal preset. Fix what a screenshot catches; two real defects in the order-stages work were only ever found this way.

- [ ] **Step 4: Full verification** — `npx turbo run test --concurrency=1`, `pnpm --filter @marketplace/web build`, `pnpm --filter @marketplace/engine build`, `pnpm --filter @marketplace/agents build`, `pnpm --filter @marketplace/engine test:e2e`, `pnpm e2e`. Re-run any red suite alone before believing it.

- [ ] **Step 5: Status docs + final commit**

```bash
git add apps/web/test/e2e-journeys/run.mjs docs/STATUS.md docs/STATUS-onboarding.md
git commit -m "test: onboarding journeys; docs: status for owner onboarding"
```
