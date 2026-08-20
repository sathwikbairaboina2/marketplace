# Onboarding: understand requirements, infer what the business needs

Status: design approved, not yet planned
Date: 2026-08-21

## Problem

The onboarding wizard extracts four facts — `kind`, `name`, `tone`, `audience`
(`packages/contracts/src/storefront.ts:124`) — and the moment all four parse,
`profile-check.node.ts` flips to `generating` and the graph runs straight to
theme and copy. One sentence buys a whole storefront.

Nothing ever asks what the shop actually sells, how it fulfils, or what it
would need to record about a sale. Two consequences, both observed in a browser
session across four tenants on 2026-08-21:

- **The copy is shallow because the interview is shallow.** A yoga studio that
  said "we do not really sell products" got a correct `Book Now` CTA and then a
  three-up `Product One / Product Two / Product Three` grid, because nothing
  downstream knows the shop is bookable rather than stocked.
- **The owner still sets up their own shop.** A separate graph
  (`draft-schema.node.ts`) already knows how to add fields to
  Product/Order/Event/Booking. Onboarding never touches it, so the owner
  finishes the wizard with a themed storefront and an empty catalogue.

## Goal

The wizard interrogates until it genuinely understands the business, then
proposes a concrete setup — what the shop sells, which categories, which extra
fields — that the owner confirms with a click.

## Non-goals

- **Feedback does not regenerate the plan.** A message to a drafted thread
  still routes to `proposeTheme`, as today. Re-deriving the setup plan on
  "make it warmer" would discard the owner's checkbox state to no purpose. If
  the owner later says "we also sell merch", the plan is stale; re-running the
  interview on demand is a follow-up change.
- **The two socket bugs found alongside this are out of scope.** A reply
  completed during a page reload is never delivered to the reconnected socket,
  and a second tab on the same tenant starts a fresh conversation instead of
  resuming (thread id lives in `sessionStorage`,
  `apps/web/lib/chat/use-onboarding-socket.ts:15`). Both are real, neither is
  caused by this feature, and a socket-lifecycle rewrite folded into this
  change would make both harder to review. Separate spec.

## Decisions

| Question | Decision |
|---|---|
| What does "recognise what the business requires" produce? | Recommendations the owner confirms, rendered in the preview pane, applied on click |
| What stops the interview? | The model judges sufficiency, bounded by a hard cap and a deterministic floor |
| How does Apply work, given field additions must be approved? | Split apply: storefront half written immediately, field half queued as proposed flows, response says exactly which was which |

## Contracts

`BusinessProfile` is **unchanged**. It is embedded in `StorefrontConfig`, which
is `.strict()` and has stored drafts in Dynamo; widening it would stop every
existing draft from parsing. The operational answers go in a sibling object.

```ts
// packages/contracts/src/storefront.ts
export const SellsWhatSchema = z.enum(['goods', 'bookable', 'both']);

export const BusinessRequirementsSchema = z
  .object({
    sellsWhat: SellsWhatSchema,
    categories: z.array(z.string().trim().min(1).max(60)).max(8),
    fulfilment: z.string().trim().min(1).max(200),
    priceBand: z.string().trim().min(1).max(200),
    differentiator: z.string().trim().min(1).max(400),
  })
  .strict();
```

Profile feeds theme and copy; requirements feed the setup plan. Nothing
migrates.

The plan is proposal-only. Selection state stays client-local until Apply, so
the wire format carries no checkbox booleans:

```ts
export const FieldProposalSchema = z
  .object({
    entity: DynamicEntityTypeSchema,
    field: AddedFieldSchema,
    rationale: z.string().trim().max(200),
  })
  .strict();

export const SetupPlanSchema = z
  .object({
    sellsWhat: SellsWhatSchema,
    categories: z.array(z.string().trim().min(1).max(60)).max(8),
    fields: z.array(FieldProposalSchema).max(6),
  })
  .strict();
```

Reusing `AddedFieldSchema` from `flow.ts` is load-bearing: the add-only
`.strict()` on `BlueprintDiff` and the `refuseReservedFieldNames` refinement
come with it, so the agent cannot propose `Product.priceMinor` or a field
removal even when the model tries.

`OnboardingSnapshot` gains `setupPlan: SetupPlanSchema.nullable()`. That schema
is non-strict by design (`packages/contracts/src/agent.ts:76`), so an older
client ignores the new key rather than failing to parse the snapshot.

`StorefrontConfig` gains two **optional** keys, `sellsWhat` and `categories`.
Optional, so existing strict drafts still parse. This is where Apply writes the
storefront half; it inherits draft, publish and preview for free. Categories
become the source for the product form's category dropdown and for whether
navigation leads with Products or Events.

The caps — 8 categories, 6 field proposals — are deliberate. An open-ended
"what does this business need" against a 7B model otherwise produces twenty of
each.

### Consuming the two new keys

Adding them to the contract is not enough; two consumers make them mean
something, and both are in scope:

- **Product form** (`apps/web/app/(admin)/admin/products/new`, and the edit
  page): the category input offers `storefront.categories` as suggestions.
  Free text still wins — the field stays a string on `Product`, and a category
  the owner types is not rejected for being absent from the list.
- **Storefront navigation and the preview's placeholder grid**: `sellsWhat`
  decides whether the shop leads with Products or Events, and suppresses the
  three-up `Product One / Two / Three` grid for a `bookable` shop. That grid
  appearing under a yoga studio is the visible half of the problem this spec
  exists to fix; leaving it would ship the feature with its own symptom intact.

Both read the **published** config, not the draft, so neither changes until the
owner publishes.

## Agent graph

```
START ──drafted?──→ proposeTheme                (feedback path, unchanged)
      └─else────→ interview
interview ──gathering?──→ END                   (asked a question, await reply)
          └─satisfied?──→ inferNeeds
inferNeeds → proposeTheme → draftContent → assembleDraft → dispatchDraft → END
```

### `interview` (replaces `profileCheck`)

One structured call per turn, one question per turn — the rhythm
`profile-check.node.ts` already has, no longer satisfied by four shallow facts:

```ts
{ satisfied: boolean, profile: {...} | null, requirements: {...} | null, question: string }
```

The model judges its own sufficiency. Three guards bound that judgement:

- **Floor.** `satisfied` is ignored unless `profile.name` and `profile.kind`
  parse against `BusinessProfileSchema`. A model that declares victory on "hi"
  does not get to.
- **Cap.** `questionCount` lives in state and increments each time the node
  returns a question. At `ASK_MAX` (5) the graph proceeds regardless.
- **Graceful degradation.** `requirements` is returned only when complete;
  partial stays `null`. Reaching the cap with `requirements: null` produces
  exactly today's behaviour — the storefront drafts, `setupPlan` is `null`, the
  wizard shows the preview alone. No dead end.

### `inferNeeds`

Profile plus requirements to a `SetupPlan` in one structured call, retried to
`DRAFT_MAX_ATTEMPTS` like the other generative nodes.

Validation is **per-proposal, not all-or-nothing**: a field that trips
`refuseReservedFieldNames` or `AddedFieldSchema` is dropped and the rest of the
plan stands. One bad field name must not cost the owner their whole plan.

### State and phases

New slices: `requirements`, `setupPlan`, `questionCount`. Defaults are added to
`ONBOARDING_FIELD_DEFAULTS` so the channels and defaults keep reading from one
object, as `state.ts` already requires; `state.test.ts` pins the pairing.

No new `OnboardingPhase`. `inferNeeds` runs inside `generating`, so that closed
union stays closed.

### Prompts

`PROFILE_SYSTEM` becomes `INTERVIEW_SYSTEM`, instructed to ask about what is
sold, how it is fulfilled, price band and what makes the business different —
one question at a time, never inventing values the owner has not given. A new
`NEEDS_SYSTEM` maps a described business to entities, categories and fields,
told explicitly that fields are add-only and that core field names are
unavailable (the node enforces both regardless).

### Cost

One extra LLM call per onboarding, plus up to four extra interview turns.
Against the local CPU ollama at ~10 tok/s that is the difference between ~40
seconds and a couple of minutes to first draft. Acceptable against a hosted
model; noticeable locally.

## Apply path

The endpoint lives on **agents**, not engine: agents holds `DispatchService`
and already writes storefront drafts through `EngineClient` in
`dispatchDraft`.

```
POST /onboarding/setup-plan/apply
```

Carries both a `@Roles('admin')` decorator and a service-side check — the
decorator makes the restriction visible in the OpenAPI document, the service
check is what the unit tests pin and what protects a non-HTTP caller.

```ts
// request — the checkbox subset, not the whole plan
{ sellsWhat, categories: string[], fields: [{ entity, field }] }

// response — per-item truth
{ applied: { sellsWhat, categories },
  queued:  [{ entity, fieldName, messageId }],
  failed:  [{ entity, fieldName, reason }] }
```

**Order: storefront first, then dispatch.** If the draft write fails, nothing
is queued — no field additions for a shop whose type never took. If a dispatch
fails after the draft landed, it lands in `failed[]` and the owner sees which;
the storefront half is reversible in the preview.

That ordering is also why partial failure returns 200 with per-item status
rather than a problem document. Whole-request failures remain RFC 9457
(`dispatch-failed`, 502, already declared in the closed `ProblemType` union). A
partial success is not an error, and collapsing it into one would hide which
half happened.

**The client's subset is never trusted.** `refuseReservedFieldNames` and
`AddedFieldSchema` run again server-side against every submitted field,
independent of what the plan proposed. A doctored request cannot add
`Product.priceMinor` because the plan happened not to.

**Idempotency is inherited.** `DispatchService.deduplicationId` is
`sha256(threadId + canonicalJson(payload))` inside a five-minute FIFO
deduplication window, so a double-clicked Apply collapses into one proposal —
the same property `dispatchDraft` relies on.

**Known wart.** The storefront half is read-modify-write: GET draft, merge
`sellsWhat` and `categories`, PUT draft. An owner editing the preview inline at
that instant could lose that edit. Single-owner wizard, seconds-wide window;
accepted rather than adding optimistic concurrency to `PUT /storefront/draft`
for one caller.

## Web

`PreviewPane`'s segmented control gains a fourth option, **Setup**, rendered
only when `setupPlan` is non-null. The rest of the wizard is untouched.

The tab shows `sellsWhat` as radios, categories and field proposals as
checkboxes, each field carrying its one-line rationale so the owner knows why
`Event.durationMinutes` is suggested. Selection is local `useState`, all boxes
checked initially. Nothing is sent until Apply.

Apply lives in the pane, not the page header: the header's two buttons already
mean "abandon onboarding" and "go live", and this is neither. On success the
pane swaps to a result view listing what applied and what was queued, with a
**Review in Flows** link to `/admin/flows`. Failures go through
`notifyProblem`, as every other call in the wizard does.

No `Popconfirm` on Apply. Publish has one because it changes what customers
see; Apply changes a private draft and queues proposals a human still executes.
Two confirmations for one reversible action trains people to click through.
`window.confirm` is out regardless — a native modal takes the browser harness
down with it.

### Folded-in fix: optimistic echo

The interview now runs up to five turns instead of one. Today the user's own
message does not render until the agent's turn completes — a measured
~40-second silence with an empty chat log, indistinguishable from a dropped
send. At one turn that is annoying; at five it reads as a broken product.

So: optimistic echo of the user's message on send, plus a pending indicator
while the turn runs, in `use-onboarding-socket.ts` and the message list.
Reconciliation is trivial because the server snapshot is authoritative — the
optimistic message is replaced wholesale when `state` arrives.

This is scoped in because this feature is what makes it necessary, not as
general socket cleanup.

## Testing

- **Contracts** (`packages/contracts`): `SetupPlanSchema` rejects an over-cap
  plan; `FieldProposalSchema` rejects a reserved core field name per entity;
  `OnboardingSnapshot` still parses without `setupPlan` (older server).
- **`interview` node**, scripted provider: floor — a model returning
  `satisfied: true` with an unparseable profile still yields `gathering`; cap —
  the fifth question forces `inferNeeds`; degradation — cap reached with
  `requirements: null` yields a snapshot with `setupPlan: null` and a drafted
  storefront.
- **`inferNeeds` node**, scripted provider: a plan containing one reserved
  field name drops that proposal and keeps the others; an unparseable plan
  retries to `DRAFT_MAX_ATTEMPTS`.
- **Apply endpoint** (int-test): storefront write precedes dispatch; a failing
  dispatch leaves the storefront half applied and reports `failed[]`; a failing
  storefront write queues nothing; a submitted reserved field name is refused
  server-side even when absent from the plan; the admin check is enforced in
  the service, not only the decorator.
- **Web** (vitest): Setup tab hidden when `setupPlan` is null; unticking a
  field omits it from the request; the result view renders `queued` and
  `failed` distinctly.
- **Browser**: extend the onboarding journey to run an interview to a setup
  plan and apply it, asserting the Flows screen shows the proposals. Verify the
  Setup tab by screenshot — passing tests prove behaviour, not appearance.

Run gates per `CLAUDE.md`: `nest build` and `next build` are the type check,
and the repo-wide run is `npx turbo run test --concurrency=1`. Re-run any red
suite alone before believing it.
