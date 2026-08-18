# Owner-defined order stages, with per-stage messaging and cancellation

18 August 2026

A shop owner defines the stages an order passes through — their own names, their
own number, their own order. The seller advances an order along them; the buyer
watches it move. Each stage carries two switches: whether the buyer may cancel
while the order sits there, and whether that stage has a two-way message thread
between buyer and seller.

Nothing in the code knows what a stage means. A shop with one stage called
`Confirmed` and a picture framer with `Order received → Awaiting artwork → Mount
cut → Glazed & sealed → Ready for collection → Collected` run through the same
code path.

## Why this shape

Three decisions drive everything below.

**Stages are pinned to the order, not looked up.** An order copies the stage list
it was placed under and walks that copy to the end. This is the choice
`orders.service.ts` already made for money — `unitPriceMinor` is copied onto the
line item at write time *"so a later price edit never rewrites this historical
order"*. A pinned stage list is that same argument applied to lifecycle. An
owner's rename or reorder changes what new buyers see and can never reach an
order already in flight.

**`OrderStatusSchema` does not change.** Stages are a new field beside `status`,
which stays `confirmed | cancelled`. The tracker answers *where the order is*;
the status tag answers *what it is*. Every existing contract, test and
`StatusTag` render keeps working, and the change stays additive.

**There is no migration.** A tenant that has never configured a pipeline gets a
built-in default; an order written before this feature existed is normalised on
read into that same default. Absence is a state, exactly as `getAnnouncement`
already treats a shop that has never set an announcement.

## Naming, and two collisions to avoid

- **`Flow` is taken.** `CreateFlowSchema` is schema evolution — `ADD_FIELDS`
  against a dynamic entity, add-only, agent-proposed, admin-executed. It is not
  a workflow engine and must not be confused with one. This feature uses
  *pipeline* and *stage*.
- **The engine's `messaging` module is taken.** It is the SQS consumer for agent
  flows. The chat feature lives in a new `threads` module.

## Data model

New contract file `packages/contracts/src/pipeline.ts`:

```ts
export const MAX_STAGES = 12;

export const StageSchema = z.object({
  id: UlidSchema,
  name: z.string().trim().min(1).max(60),
  cancellable: z.boolean().default(false),
  messaging: z.boolean().default(false),
}).strict();

export const PipelineSchema = z.object({
  version: z.number().int().nonnegative(),
  stages: z.array(StageSchema).min(1).max(MAX_STAGES),
}).strict();

export const UpdatePipelineSchema = z.object({
  version: z.number().int().nonnegative(),   // the version the editor loaded
  stages: z.array(StageInputSchema).min(1).max(MAX_STAGES),
}).strict();
```

`StageInputSchema` is `StageSchema` with `id` optional: present means keep that
stage, absent means mint a new ULID server-side.

A stage's identity is its **ULID, never its name**. Renaming must not orphan the
stage's messages or the orders pinned to it.

A trimmed, non-empty name because a blank stage would do to the tracker what
bug #8's blank product name did to a card. `MAX_STAGES` is bounded for the same
reason `MAX_ORDER_LINE_ITEMS` is: the list is rendered as a tracker and copied
onto every order.

**`DEFAULT_PIPELINE`** — version `0`, one stage named `Confirmed`,
`cancellable: true`, `messaging: false`, with a fixed sentinel id (`'0'.repeat(26)`,
valid Crockford base32). Version `0` means "never configured"; a real save starts
at `1`.

**Order gains four fields:** `pipelineVersion`, `stages` (the snapshot),
`currentStageId`, `stageEnteredAt`. `toResponse` fills `DEFAULT_PIPELINE` when
they are absent, so `OrderResponseSchema` can require them while every existing
record still parses.

**`registry.ts` must gain them too.** `ENTITY_FIELDS.Order` grows `stages`,
`currentStageId`, `pipelineVersion` and `stageEnteredAt`. Without that a tenant
can add a dynamic attribute named `stages` — bug #6 exactly, the tenant field
shadowing a core one, with `refuseReservedFieldNames` already built to stop it.

**`Message`** is a new stored entity and is deliberately **absent** from
`DynamicEntityTypeSchema`: no dynamic attributes, no reserved-name surface.

```ts
MessageRecord {
  PK; SK; entityType: 'Message';
  id; orderId; stageId;
  authorUserId; authorRole: 'buyer' | 'seller';
  body; createdAt;
}
```

`authorRole` is copied at write time rather than resolved at read time. Same
argument as `unitPriceMinor`: a role can change later, and a historical
conversation should show who someone was when they wrote it.

### Storage

| What | Where |
|---|---|
| Pipeline config | `settingsSk('pipeline')` — the existing tenant-settings item, admin-write / tenant-read |
| Stage snapshot | on the order record |
| Messages | new `messageSk(orderId, id)` → `MESSAGE#<orderId>#<ulid>`, queried by `begins_with` |

`keys.ts` gains `Message` in `KeyedEntityType` and `SK_PREFIX`, alongside the
`messageSk(orderId, id)` and `messagePrefix(orderId)` helpers.

ULID message ids sort chronologically, so a thread reads in order with no sort
key gymnastics.

## Engine

### `GET /settings/pipeline`

Any signed-in member of the tenant. Returns the stored pipeline, or
`DEFAULT_PIPELINE` when there is none.

### `PUT /settings/pipeline`

Admin only, `403` otherwise, matching `updateAnnouncement`. Body is the full
stage list plus the version it was edited from. Written with
`ConditionExpression: '#version = :expected'`, bumping to `version + 1`.

Two admins editing at once: one commits, the other gets `409
pipeline-version-conflict` and re-reads. This is bug #9's lesson — a stale write
silently clobbering a concurrent edit — closed at the API rather than trusted to
the form.

Rejected at validation: duplicate stage ids, and duplicate names after trim and
case-fold. Two stages both labelled "Shipped" is bug #6's two inputs labelled
"Name", one layer up.

### `POST /orders/:id/advance`

Admin only. Body `{ currentStageId }` — the stage the seller was looking at.

```
ConditionExpression: '#currentStageId = :expected AND #status = :confirmed'
SET #currentStageId = :next, #stageEnteredAt = :now
```

Conditioned rather than read-then-written, so two sellers clicking at the same
moment cannot skip a stage between them — the same reasoning as `#stock >= :qty`
in `create`.

Failures: `409 stage-moved` if someone else advanced it, `409
order-at-final-stage` on the last stage, `409 order-not-advanceable` if
cancelled.

A shop that has never configured a pipeline has one stage, which is therefore
also the last one, so **every advance in an unconfigured shop returns `409
order-at-final-stage`**. That is correct, not a defect: there is nowhere to
advance to. The cockpit renders the button disabled rather than letting a seller
discover it as an error.

**Forward only.** There is no un-advance endpoint. A seller who over-clicks has
no route back. Adding one means deciding what a reopened stage does to a closed
message thread; that deserves its own answer rather than a guess now. This is
the one deliberate gap in the design.

### Order creation

`create` copies the current stages into the snapshot and sets `currentStageId`
to the first stage. The read-then-write window this opens — a pipeline saved
between the read and the commit — closes the way the price guard does: a
`ConditionCheck` on `SETTINGS#pipeline` for `#version = :expected`, appended
**after** the order `Put`.

The ordering matters: `explainFailure` maps a failed transaction index back to a
line item on the assumption that items `0..n-1` are the stock updates. The
`ConditionCheck` goes last so that mapping is untouched.

A pipeline saved mid-checkout fails the transaction; the buyer retries and gets
the new pipeline.

### `POST /orders/:id/cancel`

The buyer who owns the order, only. Non-owner, other tenant, and missing all
return `404` — never `403`, per the project rule that a 403 leaks existence.

Permitted when `status === 'confirmed'` **and** the stage the order currently
sits in has `cancellable: true` **in its own snapshot**. The owner decides where
the point of no return is, and the order carries that decision with it, so a
pipeline edit cannot retroactively make a shipped order cancellable.

```
per line item:  SET #stock = #stock + :qty      COND attribute_exists(PK)
order (last):   SET #status = :cancelled        COND #status = :confirmed
                                                 AND #currentStageId = :expected
```

The stage in that condition is the one that matters. A seller can advance the
order from a cancellable stage to a non-cancellable one in the gap between the
buyer's page rendering and their click; without it, the buyer cancels goods that
just shipped and stock comes back for items that physically left. `:expected` is
the stage id the server itself read a moment earlier, so the client neither
sends it nor can spoof it.

The status condition is what makes double-cancel impossible and what guarantees
the stock restore happens exactly once.

**No price condition on the way back.** `create` conditions on price because it
is charging money; returning stock does not care what the product costs now.

Problems: `409 order-not-cancellable` (stage not cancellable, or already
cancelled), `409 stage-moved`, `404` for a line item's product that no longer
exists, `409 transaction-conflict` via the existing helper.

**No `IdempotencyInterceptor`.** The status condition already makes cancel
single-shot; a retry after success gets a clean `409` rather than a replayed
`200`.

**No upper-bound guard on restored stock.** `StockSchema` caps at `MAX_QUANTITY`,
but that reads as an input bound rather than a stored invariant, and conditioning
on it would fail a buyer's cancel for a reason they cannot fix.

**A cancelled order keeps its stage.** `currentStageId` stays put, so the tracker
can say *cancelled at Packed* rather than merely *cancelled*. Its open thread
closes to read-only, as on advance.

### `POST /orders/:id/messages`

Body is `{ body }` alone. Two things the client does not send:

- **The stage.** The server stamps `currentStageId` from the order it just read.
  This is what "the thread closes on advance" *is*, mechanically: there is no way
  to address a past stage, so a closed thread cannot be written to even by a
  client that wants to.
- **The author.** Taken from the principal.

Permitted when the caller owns the order or is a tenant admin, the order is
`confirmed`, and the current stage has `messaging: true`. Otherwise `409
stage-not-messageable` or `409 order-not-messageable`; a caller who is neither
owner nor admin gets `404`, consistent with `get`.

`body` is trimmed, min 1, max 2000 — a whitespace-only message is bug #8 again,
a record that renders as nothing.

The limiter from `22804ba` already sits in front, but a message POST is a
cheaper spam vector than anything currently exposed and wants its own tighter
bucket rather than the default one.

### `GET /orders/:id/messages`

Owner or admin. The order's messages in ULID order, each carrying its `stageId`,
paginated on the existing cursor scheme. Closed threads come back too — they are
the history. The client groups by stage against the order's own snapshot, so a
renamed stage still displays under the name the order was placed with.

## Web

### Buyer — `(shop)/orders/[id]/page.tsx`

A vertical tracker rendered **entirely** from `order.stages` and
`currentStageId`. Position is index-in-the-snapshot; there is no name lookup, no
stage-count assumption, no special case for any word. A one-stage default shop
and a twelve-stage framer render through the same code.

Under the current stage, when that stage has `messaging: true`: the thread and a
composer. Stages already passed that hold messages render in place, greyed and
read-only — which is what makes "the thread closed" legible rather than
mysterious.

Cancel is an antd `Popconfirm`, shown only while `status === 'confirmed'` and the
current stage is `cancellable`. **`Popconfirm`, not `window.confirm`** — a native
modal blocks the browser harness dead and would take the 161-case campaign with
it.

A cancelled order stops at its pinned stage, marked there. `StatusTag` keeps its
job.

### Buyer — orders list

Each row gains its current stage name beside the status, on the same argument as
`f45eb09`: a row should say what it refers to.

### Owner — `(admin)/admin/settings`

An "Order stages" section: a sortable stage list beside a live preview of the
buyer's tracker rendered from the stages as edited, with per-stage `cancellable`
and `messaging` switches, add and remove.

Save sends the version it was loaded at. A `409` says plainly that someone else
saved first and offers a reload. The preview is also where the pinning rule is
stated in words: saving publishes a new version, and orders already in flight
keep walking the version they were placed under.

### Owner — cockpit order detail

An "Advance to *&lt;next stage name&gt;*" button, disabled on the final stage,
sending the stage id the seller is looking at. Plus the seller's side of the
thread — the same component as the buyer's with the role flipped.

### Failure handling

`409 stage-moved` on advance or cancel means the page is stale: refetch through
the existing `useResource` retry and say what changed, rather than replaying the
click. Everything else goes through `ErrorPanel` as now.

## Testing

TDD throughout, red first.

**Contracts unit** — blank and whitespace-only stage names rejected, name length
bound, `MAX_STAGES` bound, duplicate ids and case-folded duplicate names
rejected, `.strict()` rejecting unknown keys, message body bounds. Plus a
regression that `reservedFieldNames('Order')` contains the four new fields —
that is bug #6's guard, and untested it rots.

**Engine e2e** — extend `orders.e2e.test.ts`; add `pipeline.e2e.test.ts` and
`threads.e2e.test.ts`.

- *Pipeline*: unset tenant returns the default at version 0; `PUT` admin-only;
  stale version 409; a new stage is minted a ULID while existing stages keep
  theirs; **renaming a stage leaves an in-flight order's tracker unchanged** —
  that single test is the whole pinning decision.
- *Advance*: admin-only; stale `currentStageId` → `409 stage-moved`; final stage
  409; cancelled order 409; `stageEnteredAt` moves.
- *Cancel*: stock restored across several line items; refused in a
  non-cancellable stage; second cancel 409 **and stock unmoved**; non-owner 404;
  cross-tenant 404; vanished product 404.
- *Threads*: the server stamps the current stage and ignores anything the client
  says about it; after an advance a post lands in the new stage and the old one
  is history; blank body rejected; cancelled order refuses; non-participant 404.

**Two race tests**, because the conditions exist for exactly these: two
simultaneous cancels leave stock restored once, and a cancel racing an advance
has one winner. Assert on resulting stock and status, **not on the error class** —
`orders.service.ts` already documents that DynamoDB Local tends to surface
`ConditionalCheckFailed` where a real table gives `TransactionConflict`.

**Web unit** — tracker renders 1, 6 and 12 stages from the snapshot with long
names; cancel hidden when the current stage is not cancellable; composer hidden
when messaging is off; a passed stage's thread read-only.

**Browser journey**, one path proving the whole thing is data-driven: owner
publishes a three-stage flow with names the code has never seen → buyer orders →
tracker shows stage one → buyer posts → seller advances → old thread read-only,
new thread open → buyer cancels in a cancellable stage → the product page shows
the stock back.

**Screenshots** of the tracker at one, six and twelve stages, and of the editor.
Passing tests prove behaviour, not that a twelve-stage tracker still looks like
anything.

**Run discipline on this machine**: `npx turbo run test --concurrency=1`,
host-side harnesses on `127.0.0.1`, ollama on `11435`.

## Out of scope

Named here so the boundary is a decision rather than an oversight. Each is a
later pass, and none requires reopening the contracts above except where noted.

- **Unread state and notification** of any kind.
- **Attachments** on messages. The `uploads` module makes this tempting and it is
  its own authorization problem.
- **A cross-order inbox** for the seller, and an unread badge on the cockpit
  order list.
- **Un-advancing** a stage — see the note under `POST /orders/:id/advance`.
- **Per-category or per-product pipelines.** One pipeline per tenant, decided
  because a mixed-category order has no single lifecycle without a further rule.
- **Actions that execute on entering a stage.** Stages are labels the seller
  advances by hand; nothing runs.
