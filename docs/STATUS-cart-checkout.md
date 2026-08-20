# Status — server-side cart and checkout with simulated payment

**20 August 2026.** Branch `feat/cart-checkout`. Spec:
`docs/superpowers/specs/2026-08-20-cart-checkout-design.md`; plan:
`docs/superpowers/plans/2026-08-20-cart-checkout.md`.

## What shipped

- **A cart that belongs to the buyer, not the tab.** One DynamoDB item per
  user (`CART#<userId>`), per-line writes (`PUT /cart/lines/:productId`,
  qty 0 removes, `DELETE /cart` clears). The server resolves name, price,
  image, stock and availability at read time — the client sends identity and
  quantity only, and a stale tab can never check out at a stale price. Lines
  whose product went inactive surface struck-through as `unavailable` rather
  than silently vanishing, and are excluded from the server-computed total.
- **`POST /checkout`** builds the order from the server cart through the
  existing stock-reserving transaction, into a new system-level
  **`awaiting_payment`** status that sits *before* the owner's copied stage
  list (`currentStageId` stays null until payment lands). The cart survives a
  failed checkout and is cleared only once the order exists. Legacy
  `POST /orders` is untouched.
- **Payments** behind a `PAYMENT_PROVIDER` token: one deterministic, offline
  `FakeCardProvider`. Stripe-style magic numbers — `4242 4242 4242 4242`
  succeeds, `4000 0000 0000 0002` declines, `4000 0000 0000 9995` has
  insufficient funds; everything else fails shared Luhn validation on both
  client and engine. `POST /orders/:id/pay` charges the order's own total
  (never a client amount), writes `payment: {id, last4, amountMinor, at}` —
  the card number is never stored or logged — and moves the order into
  stage 1. The write is conditioned on `status = awaiting_payment`, which is
  the double-pay and pay-after-cancel guard.
- **Cancellation from the gate** is always allowed — by the buyer, or by a
  tenant admin clearing a stale unpaid order — and restores stock through the
  machinery the order-stages feature built. `advance` refuses unpaid orders
  for free: they are not `confirmed`.
- **Web:** `CartProvider` keeps its interface but mirrors the server cart
  with optimistic updates; only the checkout idempotency key stays in
  sessionStorage. Cart page's button became **Checkout** → card form at
  `/orders/[id]/pay` (declines render inline, form intact; the page names the
  magic numbers because a simulation should say so) → tracker. The tracker
  and cockpit both render an awaiting-payment state; the cockpit hides
  advance and offers cancel-unpaid.

## Defects found while building

1. **`OrderRecord.currentStageId` was left non-nullable** when the response
   schema went nullable — the engine stopped compiling one task later.
   Caught by the next task's build step; fixed in contracts (`54b5e82`).
2. **`DELETE` was missing from the CORS preflight** — the third method to
   fall into the documented trap (`PUT` on announcements, `PATCH` on
   products, now `DELETE /cart`). Clearing the cart worked from a terminal
   and only from a terminal. Caught by the UI campaign's
   no-console-errors case; the CORS int-test now asserts DELETE (`90232c0`).

## Verification

| Suite | Result |
|---|---|
| Contracts | 161 tests green |
| Engine unit/int | 214 across 34 suites |
| Engine e2e | 128 across 16 suites (new: `cart` 7, `checkout` 7) |
| Web unit | 228 across 39 files |
| Playwright e2e | 29/29 (catalogue + idempotency migrated to the pay flow) |
| Browser journeys | 81/81 (new section: cart persistence, decline/retry, unpaid-advance refusal, abandon restores stock) |
| UI campaign | 164/164 (new: pay page pristine, decline inline, checkout lands on payment) |
| Builds | contracts, engine, web all clean |

Screenshots of the cart, pay form, decline state and awaiting-payment tracker
were rendered and reviewed (`verify by looking`), not only asserted on.

## Decisions

- **Gate over pay-first over flag.** Stock is reserved by the existing
  transaction before payment; pay-first loses the reservation race and a
  flag enforces nothing.
- **Charge-then-conditional-write is safe only because the provider is
  fake.** The comment in `pay` says so: a real provider needs an idempotency
  key on the charge and a reconciliation story before it can slot in.
- **No auto-expiry of unpaid orders.** Buyer and seller can both cancel;
  automatic expiry waits until holding stock hurts.
- **Non-magic Luhn-valid numbers succeed** at the provider; format validation
  is the schema's job on both sides.
