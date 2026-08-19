# Owner-defined order stages — 19 August 2026

The feature branch `feat/order-stages`, written overnight against the design in
`docs/superpowers/specs/2026-08-18-order-stages-design.md` and the plan in
`docs/superpowers/plans/2026-08-18-order-stages.md`. Written to be picked up
cold. `docs/STATUS.md` still describes the state of `master`; this file
describes what sits on top of it.

## What it does

A shop owner defines the stages an order passes through — their own names, their
own number, their own order. The seller advances an order along them; the buyer
watches it move. Each stage carries two switches: whether the buyer may cancel
while the order sits there, and whether that stage has a two-way message thread.

Nothing in the code knows what a stage means. A shop with one stage called
`Confirmed` and a picture framer with `Order received → Awaiting artwork → Mount
cut → Glazed and sealed → Ready for collection → Collected` run the same path.

## What is true right now

| | |
|---|---|
| Branch | `feat/order-stages`, 19 commits ahead of `master`, tree clean, nothing pushed |
| Unit and integration | 608 — contracts 130, engine 165, web 194 across 32 files, agents 80, openapi 23, auth 8, seed 8 |
| Engine end-to-end | 107 across 13 suites (was 77 across 11) |
| Browser journeys | 73 (was 65); the eight new ones are the section "A shop with stages of its own" |
| Full sweep | `npx turbo run test --concurrency=1` — 10 tasks, all green |
| Screenshots | tracker at 1, 6 and 12 stages, plus editor, queue and seller pages, all looked at |

## The three decisions that carry the design

**Stages are pinned to the order, not looked up.** An order copies the stage
list it was placed under and walks that copy to the end. This is the choice
`orders.service.ts` already made for money — `unitPriceMinor` is copied at write
time *"so a later price edit never rewrites this historical order"*. An owner's
rename or reorder changes what new buyers see and can never reach an order
already in flight. One e2e test renames every stage under an in-flight order and
asserts its tracker does not move; if that ever fails, creation has started
re-reading the pipeline instead of copying it.

**`OrderStatusSchema` did not change.** Stages sit beside `status`, which is
still `confirmed | cancelled`. The tracker answers *where*, the status tag
answers *what*. Every pre-existing contract and test kept working.

**There was no migration.** A tenant that never configured a pipeline gets a
built-in one-stage default, and an order written before this existed is
normalised on read into the same. Absence is a state, as `getAnnouncement`
already treats a shop that never set an announcement.

## Where things live

| | |
|---|---|
| Contracts | `packages/contracts/src/pipeline.ts`, `thread.ts` |
| Pipeline config | `settingsSk('pipeline')` — the existing tenant-settings item, admin-write |
| Stage snapshot | on the order record: `pipelineVersion`, `stages`, `currentStageId`, `stageEnteredAt` |
| Messages | `MESSAGE#<orderId>#<ulid>`, one `begins_with` query per thread |
| Engine | `apps/engine/src/pipeline/`, `apps/engine/src/threads/`, plus `advance`/`cancel` in `orders.service.ts` |
| Buyer | `app/(shop)/orders/[id]`, `components/stage-tracker.tsx`, `components/stage-thread.tsx` |
| Owner | `app/(admin)/admin/settings/stage-editor.tsx`, `app/(admin)/admin/orders/` |

## Endpoints added

- `GET /settings/pipeline` — any member of the tenant; the default when unset.
- `PUT /settings/pipeline` — admin; conditioned on the version the editor
  loaded, so a stale save is refused rather than clobbering the one it never saw.
- `POST /orders/:id/advance` — admin; conditioned on the stage the seller was
  looking at, so two sellers cannot skip a stage between them.
- `POST /orders/:id/cancel` — the buyer who owns it, permitted only while the
  current stage is `cancellable`. Restores stock in the mirror of `create`.
- `POST /orders/:id/messages`, `GET /orders/:id/messages` — buyer or admin.
- `GET /orders/all` — admin; the seller's queue.

## Things worth knowing before changing this

**Nothing may be inserted into the order transaction ahead of the line-item
updates.** `explainFailure` maps a cancelled transaction index back to a product
*by position*. The pipeline `ConditionCheck` on create is deliberately last.

**`ProblemType` is a closed union.** A new problem code has to be declared in
`apps/engine/src/common/problem.ts` before it can be thrown.

**Race tests assert on outcomes, never on the error class.** DynamoDB Local
raises `ConditionalCheckFailed` where a real table raises `TransactionConflict`;
`orders.service.ts` documents this. Two cancels racing must leave stock restored
exactly once; a cancel racing an advance must have exactly one winner, and if the
advance wins the stock must stay out.

**A one-stage shop is the normal case.** Every shop starts there. `advance`
legitimately refuses in it, and both cockpit pages render no button rather than
letting a seller meet a 409.

**The rate limiter runs before authentication and is keyed by address.** That is
deliberate — a limiter that only sees authenticated requests stops neither a
flood nor a password list — but it means the message bucket is shared by
everyone behind one address. It is 60/minute for that reason, not tighter.

## Behaviour changed outside the feature

**A tenant admin can now read any order in their own tenant** (`GET /orders/:id`)
and list them all (`GET /orders/all`). The seller packs and dispatches the order,
so they have to be able to see it, and `ThreadsService` already treated the
question that way. Everyone else is unchanged, a buyer still cannot read another
buyer's order, and an admin of another tenant still gets 404 — both have tests.
The pre-existing test "hides another user order within the same tenant" was
minting an admin, because `authHeaders` defaults to one; it asks for a buyer now.

**The cockpit sidebar's "Orders" link** pointed at the signed-in admin's own
purchases. It points at the shop's queue.

## Left undone, deliberately

- **No un-advance.** A seller who over-clicks has no route back. Reopening a
  stage means deciding what happens to its closed thread, which deserves its own
  answer rather than a guess.
- **The seller's order page shows a product reference, not its name.** The
  buyer's page resolves names; this one does not yet.
- **Excluded from this pass**, each its own piece of work: unread state,
  notification of any kind, message attachments, a cross-order inbox for the
  seller, per-category or per-product pipelines, and actions that run when an
  order enters a stage.

## Traps this machine will spring again

Unchanged from `docs/STATUS.md`, and all three were met during this work:
`localhost` resolving to `::1` before `127.0.0.1`; whole-repo test runs
reporting false failures under load (the agents suite failed in one sweep and
passed alone immediately after); and ollama on `11434` belonging to another
project, this stack using `11435`.

Rebuilding one container for the edit-test loop is
`docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine`
— about two minutes against nine for a full boot, most of which is the agents
container pulling its ollama model, which an engine change cannot invalidate.
