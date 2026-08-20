# Server-Side Cart and Checkout with Simulated Payment — Design

**Date:** 2026-08-20
**Status:** Approved for planning
**Phase:** 1 of the product roadmap (buyer commerce loop), first spec

## Why

The buyer loop today is shallow: the cart is `sessionStorage`, per tab, gone on
reload; checkout posts straight to `POST /orders` with no payment step. This
spec closes the loop — a cart that belongs to the buyer rather than the tab,
and a checkout that passes through a payment gate before the seller's
fulfilment stages begin.

The milestone this serves is a **complete product story locally**: payment is
simulated deterministically, but behind an interface a real provider can
implement later without reshaping the order flow.

## Decisions taken during brainstorming

1. **Authenticated-only cart.** Every shopper is already forced through login,
   so there are no guest carts and no merge-on-login logic. One cart per buyer
   per tenant.
2. **Fake card form with magic numbers.** Checkout presents a real card form;
   Stripe-style test numbers select the outcome. Deterministic failure paths
   for tests, realistic UX, no network, no secrets.
3. **`awaiting_payment` gate, not pay-first and not a flag.** The order is
   created through the existing stock-reserving transaction and *then* paid.
   Pay-first loses the stock reservation race (a successful charge for a unit
   someone else took needs refund simulation). A bare paid/unpaid flag
   enforces nothing. The gate reuses the transaction, idempotency and
   cancellation machinery unchanged.

## Cart

### Contracts (`packages/contracts`)

- A cart line is `{ productId, qty }` — nothing else. The server resolves
  name, price, image, stock and status at read time, so a stale client can
  never check out at a stale price.
- `GET /cart` returns resolved lines plus a server-computed total in minor
  units. A line whose product has gone inactive or archived is returned
  flagged `unavailable: true` rather than silently dropped, so the UI can
  strike it through.
- Quantity bounds come from the existing bounds in `common.ts`; the cart holds
  at most 50 lines.

### Engine (`apps/engine/src/cart/`)

Module shape mirrors `settings/` and `storefront/`.

- **Storage:** one DynamoDB item per buyer in the single table; a new
  `cartSk(userId)` in `persistence/keys.ts`. The item holds all lines.
- **Endpoints:**
  - `GET /cart` — resolved cart.
  - `PUT /cart/lines/:productId` body `{ qty }` — upsert; `qty: 0` removes the
    line. Per-line writes so two tabs cannot lose each other's updates, which
    a whole-document `PUT` would allow.
  - `DELETE /cart` — clear.
- **Validation:** adding a line requires the product to exist in the caller's
  tenant and be active. A line already in the cart survives its product being
  archived — it surfaces as `unavailable` on read and fails checkout with the
  product named.
- **Scope:** buyer-scoped. Ownership failures answer 404, never 403 (house
  rule).

### Web

`CartProvider` keeps its interface (`lines / add / setQty / remove / clear`)
but backs onto the API with optimistic updates. `sessionStorage` keeps only
the checkout idempotency key (it belongs to the intent, as today). The cart
now survives reload, tab close, and device switch.

## Checkout and payment

### Checkout

- New `POST /checkout` (engine): reads the buyer's server cart, validates
  every line, creates the order through the **existing order transaction**
  (stock reserved, stage list copied, line-item updates first — the
  `explainFailure` position mapping holds) with the client's idempotency key.
- The order starts in a new system-level status **`awaiting_payment`**, which
  sits *before* the owner's copied stage list: `currentStageId` is null until
  payment lands. The payment gate is not a stage — an owner cannot rename or
  delete it.
- Success clears the cart.
- **Legacy `POST /orders` is unchanged** — it places orders straight into
  stage 1 as today. Existing tests and non-UI callers are untouched; the
  storefront UI switches to `/checkout`.

### Payment provider (`apps/engine/src/payments/`)

- Interface: `charge({ orderId, amountMinor, currency, card }) →
  { paymentId, status, last4 }`.
- One implementation: `FakeCardProvider`, selected by module wiring (no env
  flag needed until a second provider exists).
- Magic numbers:
  | Number | Outcome |
  |---|---|
  | `4242 4242 4242 4242` | success |
  | `4000 0000 0000 0002` | declined |
  | `4000 0000 0000 9995` | insufficient funds |
  | anything else | rejected by Luhn/format validation (client and server) |
- The charge amount is computed server-side from the order's lines. The
  client never sends a price.

### Pay flow

- `POST /orders/:id/pay` with card fields → provider charge.
- **Success:** writes `payment: { id, last4, amountMinor, at }` onto the
  order and advances it into stage 1 of its copied stage list.
- **Decline:** RFC 9457 problem (new `ProblemType` members declared in
  `problem.ts` per house rule); order stays `awaiting_payment`; buyer retries
  with another card.
- **Abandonment:** existing `POST /orders/:id/cancel`, always permitted in
  `awaiting_payment`, restores stock through the machinery already there.
- **No auto-timeout.** Stale unpaid orders remain cancellable by buyer or
  seller; automatic expiry is a follow-up if holding stock ever hurts.

### Web

Cart page's button becomes **Checkout** → order created → card form at
`/orders/[id]/pay` → success lands on the existing order tracker showing
stage 1; decline renders the problem inline with the form intact for retry.

### Card data handling

Fake numbers, treated like real ones: sent once to the charge endpoint, never
persisted (only `last4` stored), never logged.

## Seller view

- Orders list gains the `awaiting_payment` status chip.
- Advance is refused for unpaid orders in the **service** (protects non-HTTP
  callers) and disabled in the UI.
- Seller may cancel an unpaid order; stock is restored.

## Edge cases pinned

- Double-pay → conflict problem; the first payment stands; no second charge.
- Pay on a cancelled order → problem; no charge.
- Checkout with an empty cart → problem; no order.
- Checkout when a line went out of stock → existing transaction failure
  mapping names the product by position; the cart is left intact for the
  buyer to adjust.
- Checkout with an archived product in the cart → same path, product named.
- Paying another buyer's or another tenant's order → 404, never 403.

## Testing

- **Contracts:** schema round-trips for cart line, resolved cart, payment
  fields; magic-number/Luhn validation.
- **Engine unit:** cart service (per-line upsert, 50-line cap, unavailable
  flagging); `FakeCardProvider` (each magic number); orders service gate
  (advance refused while unpaid, pay transitions to stage 1, cancel from
  `awaiting_payment` restores stock).
- **Engine e2e:** new `cart.e2e.test.ts` and `checkout.e2e.test.ts` — full
  loop: build cart → checkout → declined card → retry with success → stage 1;
  abandon path restores stock.
- **Browser journeys:** (1) buyer carts two products, checks out, declines
  once, pays with `4242…`, tracker shows stage 1, seller sees the paid order;
  (2) cancelling an unpaid order restores stock.
- **UI campaign:** card form states. Screenshots of cart, card form, and
  decline state — verify by rendering and looking (house rule).
- Race tests assert on outcomes, not error classes (house rule).

## Out of scope

- Real payment providers, webhooks, async settlement.
- Guest carts and merge-on-login.
- Automatic expiry of unpaid orders.
- Refunds (cancellation of a *paid* order keeps its existing semantics from
  the order-stages feature; no money movement to reverse in a simulation).
- Server-side cart for events/bookings — products only, as today.
