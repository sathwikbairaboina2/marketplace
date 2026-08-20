# Owner Onboarding: Agent-Generated Storefront Theming, About Page and Banners

**Date:** 2026-08-20
**Status:** Approved design, ready for implementation planning

## Purpose

A new owner signs into the cockpit and is met by an agent that asks what kind of
business they run, then generates a complete storefront presentation from the
conversation: a theme (one of five presets plus bounded tuning), an About page,
and storefront banners. The owner watches a live preview update as they talk,
edits what they like, and publishes when ready. The wizard is re-runnable later
from settings.

Decisions made during brainstorming:

- **Placement:** first-login wizard in the cockpit, re-entrant from Settings.
- **Theme model:** five hand-built presets with bounded agent tuning; contrast
  floors enforced in code, never left to the model.
- **Banners:** CSS-composed by default, owner photo upload supported, AI image
  generation as an optional provider (ComfyUI) behind an env var.
- **Publish flow:** draft everything, live preview, explicit human Publish.
  Customers never see a half-configured store.
- **Wizard layout:** conversation pane + live storefront preview split
  (option A), not a fixed stepper.

## The five presets

Approved as the launch range, each a full storefront skin (palette, type,
hero treatment, radius scale), with the business kinds they serve:

| Preset id | Direction | Serves |
|---|---|---|
| `artisan` | Artisan Warmth — cream + terracotta, serif, square corners | makers, crafts, small-batch food |
| `tech` | Midnight Tech — dark surface, electric blue, tight sans | electronics, gaming, EDC |
| `editorial` | Editorial Monochrome — black on white, italic serif, zero radius | fashion, jewellery, premium |
| `market` | Fresh Market — leaf green + orange, pill buttons, big radius | grocers, bakeries, cafés, florists |
| `studio` | Calm Studio — warm greys + sage, soft shadows | wellness, studios, bookings |

The current slate/teal storefront theme becomes a sixth internal entry,
`default`, rendered when a tenant has no published config — existing tenants
and tests are pixel-identical until an owner runs the wizard.

Presets are **code, not data**: defined in `apps/web/lib/theme/presets.ts`
beside `tokens.ts`. The database stores choices (`presetId` + overrides),
never palettes, so a preset fix ships without a migration.

## Contracts (`packages/contracts/src/storefront.ts`)

```ts
ThemeOverrides = {
  accent?: hex,           // refinement: must clear 4.5:1 as text and 3:1 as a
                          // fill against the chosen preset's surfaces
  radiusScale?: 'sharp' | 'soft' | 'round',
  fontPairing?: one of exactly four allowlisted pairings (chosen at
                          // implementation from self-hosted faces),
  heroStyle?: 'gradient' | 'image',
}

Banner = {
  id: string,
  slot: 'hero' | 'mid' | 'footer',
  headline: string, subline: string,
  cta: { label: string, href: string },
  art: { kind: 'css' }
     | { kind: 'upload', objectKey: string }
     | { kind: 'generated', objectKey: string },
}

AboutPage = { title: string, sections: Array<{ heading: string, body: string }> }

StorefrontConfig = {
  presetId: 'artisan' | 'tech' | 'editorial' | 'market' | 'studio',
  overrides: ThemeOverrides,
  about: AboutPage,
  banners: Banner[],       // max 3, at most one per slot
  businessProfile: { kind: string, name: string, tone: string, audience: string },
}
```

All strings carry explicit length bounds. `businessProfile` is what the agent
learned; kept so a re-run resumes context instead of re-interrogating the owner.
Zod validates on every write path — the contrast refinement means the agent
physically cannot store an unreadable accent.

## Engine: `storefront` module

Follows the `settings` module shape. Two items per tenant in the single table:

- `TENANT#id / SETTINGS#storefront` — published config; the storefront reads it
- `TENANT#id / SETTINGS#storefront-draft` — the wizard's workspace

| Route | Access | Behaviour |
|---|---|---|
| `GET /storefront` | any signed-in user | published config or `null` (null → default theme) |
| `GET /storefront/draft` | admin | draft + `capabilities: { imageGen: boolean }` |
| `PUT /storefront/draft` | admin | whole-document replace, zod-validated |
| `POST /storefront/publish` | admin | copy draft over published; problem if no draft |
| `POST /storefront/banner-art` | admin | optional; submits ComfyUI job, stores image via uploads, returns objectKey |

- Admin routes carry both `@Roles('admin')` and the service-level check.
- Whole-document PUT, not patches: the draft is one small document and both
  writers (agent, wizard form) sit in the same screen in front of the same
  owner; last-write-wins is acceptable.
- Publish is always a human action through the wizard. The agent can only ever
  write the draft.
- New `ProblemType` entries declared in `apps/engine/src/common/problem.ts`
  before use (at minimum `storefront-draft-not-found`; an `image-gen`
  failure/unconfigured code as implementation finds necessary).
- Banner images go through the existing `uploads` module; the config stores
  object keys only.

## Agents: onboarding graph

A second `StateGraph` beside the schema-drafting graph — own state annotation,
same Redis checkpointer, same chat gateway and thread registry. The thread
registry gains `kind: 'schema' | 'onboarding'`; the gateway routes each message
to its thread's graph. The existing graph is untouched.

Nodes:

1. **profileCheck** — determines whether business kind, name, tone and audience
   are known; if not, asks one question and ENDs the turn (the gathering
   pattern `requirementCheck` uses today).
2. **proposeTheme** — maps the profile to the nearest preset plus suggested
   `ThemeOverrides`. Output validated against the contracts enums with bounded
   retry, as the `validate` node does today.
3. **draftContent** — generates the `AboutPage` and banner copy in the owner's
   tone.
4. **assembleDraft** — pure node, no LLM: composes the full `StorefrontConfig`
   and zod-parses it. A failure here surfaces as a bug; it is never stored.
5. **dispatchDraft** — writes `PUT /storefront/draft` through the engine
   client, idempotent via the same dispatched-guard pattern as today's dispatch
   node. The emitted snapshot event is what tells the wizard preview to
   refresh.
6. **applyFeedback** — owner feedback ("warmer", "less formal", "change the
   headline") revises the relevant slice and loops back through assemble +
   dispatch.

Out of the graph on purpose: publish (human button) and image generation
(engine-side HTTP so a slow render never blocks the conversation).

Every node is testable with the scripted LLM provider; no ollama in unit tests.

## Web: the wizard

Route `apps/web/app/(admin)/admin/onboarding/page.tsx`.

- **Entry:** after login, an owner whose tenant has no published config and no
  dismissed flag is redirected here. Re-entry any time from Settings → "Store
  design". Dismissable — onboarding is never a cage. The dismissed flag is a
  tenant settings item (`SETTINGS#storefront-onboarding`), so the decision
  follows the store, not the browser.
- **Layout (option A):** conversation pane left (existing agents chat plumbing,
  thread `kind: 'onboarding'`), live preview right. Preview tabs: Storefront /
  About / Banners. Publish button top-right, disabled until a draft exists.
- **Preview renders the real storefront components** against the draft config —
  the same `resolveTheme` and the same banner/about components the live
  storefront uses, so the preview cannot drift from reality.
- **Direct edits:** copy fields editable inline in the preview pane; banner
  slots carry an upload button and — when the engine reports `imageGen: true` —
  a Generate button with a spinner on the slot. Edits write the same
  `PUT /storefront/draft`.
- No `window.confirm`/`alert`/`prompt`; antd `Popconfirm` where confirmation is
  needed (house rule — a native modal kills the browser harness).

## Web: storefront application

- `resolveTheme(config | null, mode)` — one pure function from preset +
  overrides to the CSS variable map `cssVars` emits today. Overrides may only
  touch accent, radius, fonts and hero treatment; spacing and layout variables
  never vary per tenant. `null` resolves to `default`.
- Applied **server-side** in the `(shop)` layout: fetch published config, emit
  the vars on the wrapper. No flash of default theme, no client fetch.
  `antdTheme()` receives the resolved accent so antd components follow.
- **The cockpit is never themed.** Only `(shop)` surfaces vary per tenant.
- New storefront surfaces: `/about` renders `AboutPage`; banner slots render on
  the storefront home — the hero slot replaces the current hardcoded hero when
  a config exists.
- Font pairings self-hosted via `next/font` (Inter is already present; 2–3
  more faces bundled at build time). No runtime font fetches; the container
  stays self-contained.

## Optional image generation (ComfyUI)

- Engine env `IMAGE_GEN_URL`, **unset by default**. Unset: the capability flag
  is false, the wizard shows no Generate button, nothing else changes — the
  project still stands alone.
- Set (e.g. to a ComfyUI instance such as `http://host.docker.internal:8188`):
  `POST /storefront/banner-art` builds a prompt from the business profile and
  banner copy, submits the ComfyUI job, polls to completion, stores the result
  through the uploads module and returns the object key.
- Synchronous-ish HTTP with a spinner on the banner slot; never a graph node.

## Error handling

- Every failure is an RFC 9457 problem document from the closed `ProblemType`
  union.
- Draft zod-rejects → problem to the caller; agent dispatch failures surface in
  the thread as they do for schema dispatch today.
- Publish with no draft → `storefront-draft-not-found`.
- Image generation failure or timeout → problem to the wizard; the banner slot
  falls back to its CSS art. The conversation is unaffected.
- Ownership failures answer 404, never 403, per house rule; role failures on a
  tenant's own settings answer 403 as the settings module does today.

## Testing

- **Contracts:** schema tests — bounds, banner limits, one-per-slot, the accent
  contrast refinement rejecting low-contrast values per preset.
- **Engine:** service unit tests (role checks, publish-without-draft,
  draft/publish roundtrip semantics); DynamoDB Local int-test for the two-item
  storage; banner-art capability flag on/off.
- **Agents:** per-node unit tests on the scripted provider; one graph int-test
  driving a full onboarding conversation to a dispatched draft; a feedback-loop
  test revising a published headline.
- **Web:** vitest on `resolveTheme` — five presets × light/dark × override
  combinations, asserting emitted variables and contrast floors; wizard page
  tests with mocked engine.
- **Browser journeys:** fresh owner → wizard → scripted conversation → preview
  updates → publish → storefront shows theme, about page and banners; re-run
  from settings; dismiss path.
- **Screenshots:** all five presets rendered and looked at, light and dark.
  Passing token tests prove behaviour, not appearance.
- **ComfyUI:** int-test skipped when `IMAGE_GEN_URL` unset.
- Repo-wide runs stay `npx turbo run test --concurrency=1`; a red suite is
  re-run alone before it is believed.

## Out of scope

- Multi-page site building, custom CSS injection, arbitrary layout editing.
- Theming the cockpit.
- Image generation as a hard dependency, hosted image APIs, API keys.
- Per-product or per-event theming; the theme is store-wide.
- Migrating existing tenants: absence of config is the migration story.
