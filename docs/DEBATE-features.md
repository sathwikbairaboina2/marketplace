# Debate — round 4: the four features, and the two preconditions nobody costed

**Date:** 2026-09-04, evening · The fourth debate, and the first held *after* a
decision rather than to reach one. The founder had already approved four
feature sets — the repeat-customer set, the front door and gallery, fulfilment
options, and UPI — so the question put to the room was not *whether* but **in
what order, in what shape, and what each has to contain to be worth building**.

Four roles argued it: the same **merchant** (Asha, the Kothrud potter), a
**data and domain architect**, a **payments and risk lead**, and a **product
designer**. The session refereed, and every load-bearing claim below was
re-checked in the tree before it was recorded.

Everything ruled in `docs/DEBATE-storefront-2.md` shipped earlier today, so
this round argues from a shop that works: guest checkout and guest booking both
complete, the theme reaches the page, there is a footer, prices are in rupees,
and an order has a number a person can read.

## The two preconditions

Both were found by roles who had been asked about something else, and both
reprice the brief.

**1. There is no mailer.** Verified: no `nodemailer`, no `@aws-sdk/client-ses`,
no Postmark, SendGrid or Resend in any `package.json`, and no notification
module among the twenty-six in `apps/engine/src`. **This shop has never sent a
customer anything.** `cart/page.tsx` tells a guest to "keep this with your
order number", and the only artefact of a purchase is a web page they must not
close.

Two of the four approved sets — order history and back-in-stock alerts — are
email features standing on a thing that does not exist. The customer record was
not the precondition; the mailer is. **1.5 days, and it comes first of the two.**

**2. There is no register for the class we shipped this morning.** The
merchant's find, and the sharpest thing said in this round.
`admin/bookings/page.tsx` renders **Booked · Event · Status · Tickets · Ref** —
no name, no phone, no email — and `GuestBookingSchema` collects only an email,
so a name and a number were never captured at all. `admin/orders/page.tsx` has
**no search of any kind**.

So: Saturday, 9.50am, six people booked. She holds five reference codes and
cannot ring the sixth, cannot message the group, cannot tick anyone in, and
cannot tell them on Thursday that their bowls are out of the kiln — the message
that turns a ₹6,500 class into a ₹2,000 mug sale. **We shipped the booking and
not the class.** She prices it at ₹13,000–19,500/month; it is about a day.

## The merchant reorders the brief, twice

**She wants UPI first**, against the architect's build order, and her reason is
not about payments: *"₹0 goes through the product until UPI lands, so the three
things built before it are shipped into a shop that has never taken a rupee and
I cannot test any of them. While payment is on WhatsApp, the conversation and
the order follow it there."* Nobody in Pune pays for a ₹1,400 mug by card.

**And she split the second bundle apart.** "The front door and the gallery"
was one row on the founder's list. Her numbers: deferring the front door costs
**₹0** — nobody types her domain, every visitor arrives on a product link from
Instagram — while deferring the gallery costs about **₹14,000/month**, because
in a DM she sends four photographs and it converts. *"A front door is a page, a
gallery is a sale."* The row is now two rows and they sit in different halves
of the plan.

Her updated ladder, after this morning: **₹0 today, for one reason instead of
five — card-only.** ₹499 the month UPI takes a real rupee. ₹999 the month the
class runs off a register. ₹2,499 the month a repeat customer's re-order goes
through the site, **found by phone number** — not by email, because every
customer she has is a phone number.

## Rulings

**1. Part payment is not a payment feature.** The payments lead's call, and the
referee agrees. As a payment feature it is 7–9 days, multiplies the order state
space, and ends with goods shipping against an unsecured loan underwritten by a
potter. The honest version, given that collection-at-the-studio is being built
in the same batch: **a deposit is a price.** The order is paid in full for the
deposit — one intent, no new payment machinery — the balance is recorded as
`balanceDueMinor`, and it is collected in the room on the QR code she already
has. **2 days instead of 7–9**, and the shape decision 7 of round 3 already
blessed for bookings.

The architect reached the same place from the data side: `partly_paid` touches
thirteen `status` readers and **four fail silently** — `stats.service.ts:65`
would drop half-paid orders out of revenue with no error at all. The status
enum stays shut.

**2. UPI is built in Docker before a real key exists.** The local provider is
not a stub that flips the order to paid. It writes an intent, hands the browser
a fake UPI approval page with Approve / Decline / **Walk away**, and Approve
signs a Razorpay-shaped payload and POSTs **the engine's real webhook route** —
so signature verification, dedupe and the conditional write are exercised by
every local test. `RazorpayProvider` is written against the documented API and
registered only when its env vars exist, and it is **ninth of ten steps**: the
whole asynchronous machine is proven before a credential is involved.

**3. The sweeper is launch-blocking, and it was not before.** Checkout takes
stock *before* payment and this engine has no sweeper. That is survivable with a
card form, where the shopper is on the page. UPI hands them to another app, and
a walk-away parks a one-of-one mug indefinitely. **1 day, modelled on the
existing SQS consumer, calling the `lifecycle.cancel` that already restores
stock.**

**4. Two live bugs were found by roles looking for something else.**

- `PaymentSchema.amountMinor` is `MinorAmountSchema`, capped at
  `MAX_MINOR_AMOUNT` (1e10) — while `order-payment.service.ts` records
  `totalAmountMinor`, which the comment in `common.ts` says may legitimately
  reach 5e15. The engine can write a payment its own `.strict()` response
  schema then refuses to parse: a paid order whose page breaks. Reachable only
  above ₹100,000,000, but it is a contract contradicting itself.
- An **appended** transaction item's condition failure is invisible to
  `explainFailure` (which filters `i < input.items.length`) and reaches the
  problem filter as a **500**. Today's `ORDERREF#` Put is conditioned and safe
  only because a ULID tail does not repeat; a customer pointer keyed on an
  email hash **would collide on every returning customer's second order**. Any
  new appended item must be an unconditioned Put or an Update.

**5. A two-product shop is broken and nobody had photographed one.**
`globex-mob-02-grid.png`: cards occupy **203 of 390px**, hard against the left,
half the screen empty. `.mp-shop-layout` keeps `align-items: flex-start` when it
turns to a column at ≤767px; `.mp-rail` was patched with `width: 100%` and
`.mp-shop-results` never was, so it shrinks to its content. **One declaration** —
and it is exactly the merchant with three products and one photograph that
every plan here claims to serve.

**6. The gallery renders nothing at n=1.** The designer's best call. Every
affordance — dots, arrows, a counter — is a promise of a photograph the
merchant does not have, and a one-of-a-kind potter often has one. At n=2 there
is no widget on desktop either; the second image simply stacks. The **cover
chooser is part of the gallery, not a follow-up**: `image-uploader.tsx` has Add
and Remove and no reorder, so `images[0]` — the tile the whole shop is sorted
and cross-sold by — is currently *file-picker order*.

**7. Repeat customers get no account.** The product deliberately has no sign-up
route, and inventing one by the back door is refused. Identity is the email
hash, which is where `mayActOn` arrived this morning by a different road.
History is a `CUSTOMER#<hash>#ORDER#<ulid>` pointer written in the checkout
transaction — the `ORDERREF#` pattern again — read in one query, no new index.
The architect costed a GSI2 and abandoned it: `ensureTable` returns early when
the table exists, so there is no `UpdateTable` path in this repo at all.

**8. The waiting screen must never lie.** UPI means the customer approves on
another device and the page finds out later. It shows the amount, the order
number and an indeterminate bar; no countdown; no cancel for thirty seconds;
then "still waiting on your bank" with an *I've paid, check again*; then an
honest "we haven't heard back yet" with three live exits. It must **never** say
*failed* on a timeout, never show a second Pay button, never auto-navigate, and
never lose the order number.

## The order of work

The merchant argues revenue, the architect argues rework, and both are right on
their own axis. The resolution is that the merchant's own numbers put two
*small* items above everything: the class register (₹13,000–19,500/mo, ~1 day)
and the gallery (₹14,000/mo, ~1.25 days). Those are days, and they collide with
nothing.

**First — the cheap and the wrongly-deferred (≈6 days)**

| | Item | Cost |
|---|---|---|
| 1 | The capture-found defects: the two-product grid, the order number printed twice, the Cancel/SUMMARY collision, toasts landing 700px above the thumb | 0.5 d |
| 2 | The class register: name and phone on a guest booking, contact columns in the cockpit, search on orders and bookings | 1 d |
| 3 | The gallery, with the cover chooser | 1.25 d |
| 4 | Collection at the studio instead of delivery | 1.5 d |
| 5 | The deposit — a balance owed, not a second payment | 2 d |
| 6 | The two live bugs above | 0.25 d |

**Then — the machine (≈8 days)**

| | Item | Cost |
|---|---|---|
| 7 | The mailer | 1.5 d |
| 8 | The customer record, and history found by phone or email | 3 d |
| 9 | Back-in-stock alerts, on the existing queue | 2 d |
| 10 | The front door | 2 d |

**Then — UPI (≈11.5 days, in the payments lead's ten steps)**

Raw body and webhook skeleton · widen the seam · `payment_pending` everywhere ·
intent record and the local provider with its fake phone · **the webhook handler,
which is the point of no return** · the payments e2e suite · the sweeper · the
pay page and its waiting screen · `RazorpayProvider` · refund-owed.

## Where each role was wrong

- **The merchant** wanted UPI first and the customer record last, then said she
  would pay more for the customer record than for UPI. She let that stand: the
  first is what makes the product a shop, the second is what makes it hers.
- **The architect** costed a GSI2 for customer email and a first-class
  `Customer` entity with its own id, and abandoned both — the second is an
  existing backlog item at a quarter of the fidelity. He also had to correct the
  referee, who had noticed that `assertOwnGsi1Pk` only requires a tenant prefix
  and thought GSI1 was free for a second access pattern: an item has one
  `GSI1PK`, and an order's is already spent on the user index.
- **The payments lead** declined four controls his field would normally insist
  on — strict event ordering, automatic refunds, an event-log UI, alerting —
  for a merchant doing a handful of orders a week, and named the one he would
  not cut under deadline: the sweeper.
- **The designer** killed his own six-section home page when a two-product shop
  disproved it, dropped a featured shelf that `products.service.ts` already
  draws at the head of the grid, dropped lightbox zoom and thumbnails, and
  wrongly generalised the grid defect to the events page — `events/page.tsx`
  renders outside `.mp-shop-layout`, which narrows the bug to the products page
  and makes the one-line fix worth more, not less.
- **The referee** shipped guest class booking this morning and did not notice
  that nothing in the product tells the merchant who is coming.

The four position papers stayed in the session scratchpad. This document is the
record.
