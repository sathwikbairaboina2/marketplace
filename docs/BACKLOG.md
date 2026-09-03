# Backlog — what is left, in the order it should ship

**Date:** 2026-09-03 · **Written in role** by the session acting as Product
Manager, from `docs/ROADMAP.md`, `docs/STATUS.md`, the Theme A designs, the
97 journeys in `apps/web/test/e2e-journeys/run.mjs`, and
`docs/RESEARCH-shopify-gaps.md`. Sizes are working days for one engineer
who knows this codebase; the guest checkout slice was one day and forty
files, and that is the calibration. Items already done are not listed:
Theme A's public read surface, SEO and guest checkout; phase 0's remote, CI
and typecheck; the debt list except journey sharding.

Each item: outcome; why now; in; out; acceptance journey; touch points; size;
depends on; question for the CEO.

## Sequence

### 1. A merchant's shop is on a real URL by Friday

Why now: nothing else can be shown to a merchant until it is. In: one rented
VM, Compose stack, Caddy with wildcard TLS for `*.<domain>`, nightly
snapshots of the DynamoDB Local data file and Redis to object storage, a
scripted restore that is run once, the four seeded shops reachable. Out: AWS,
CDK, autoscaling, a second environment. Journey: "the seeded acme shop is
reachable on its subdomain from another machine and a stranger buys a mug".
Touch: `docker/` (a production override file and Caddy), `scripts/`
(snapshot and restore), `docs/`. Size: 2 days. Depends on: nothing. CEO:
domain name to buy.

### 2. Real money: Razorpay behind the provider seam

Why now: a shop that only takes a fake card cannot take a stranger's money,
which is the quarter's metric. In: `RazorpayPaymentProvider` implementing
`PAYMENT_PROVIDER` with order creation, checkout handoff and a signed
webhook endpoint that is the source of truth for `paid`; a reconciliation
job that resolves `awaiting_payment` orders older than an hour; full refund
with stock restore per stage (decision 5); UPI and cards. Out: partial
refunds, subscriptions, Stripe. Journey: "a stranger pays with a Razorpay
test UPI id, the webhook confirms the order, the seller refunds it and the
stock comes back". Touch: `apps/engine/src/payments`, `orders/order-payment.
service.ts`, `orders/order-lifecycle.service.ts`, a webhook controller,
`packages/contracts/src/payment.ts`, the pay page in `apps/web/app/(shop)/
orders/[id]/pay`. Size: 5 days. Depends on: 1 for a public webhook URL. CEO:
decision 1 confirms Razorpay first.

### 3. The store speaks: order and booking emails

Why now: a guest who paid and got no email has no proof of purchase and no
way back except the lookup page. In: a provider interface with SES-or-SMTP
and a console provider for Docker; templates for order placed, payment
received, stage advanced (owner's stage names), booking confirmed, guest
order lookup link; sent from the SQS consumer so a failed send retries.
Out: marketing email, SMS, WhatsApp, abandoned cart. Journey: "the guest who
bought the mug receives an email naming the order and the stage". Touch:
`apps/engine/src/messaging`, a new `notifications` module, `packages/
contracts/src/sqs.ts`, `docker/docker-compose.yml` (a mail sink such as
Mailpit for journeys). Size: 3 days. Depends on: 2 for the payment event.
CEO: none.

### 4. Bookings that a studio actually runs

Why now: decision 6 leads with makers who teach, and the base plan must
carry what Shopify's booking apps gate. In: sessions per event (recurring
dates, each with its own capacity), multi-session courses booked as one,
staff assignment per session, a seller's attendance list per session with
check-in, buyer cancellation with capacity restore per stage rule, guest
booking on the guest ticket. Out: resource booking (rooms, equipment),
waitlists, calendar sync. Journey: "a stranger books two places on the
Saturday session of a four-week course and the seller sees them on that
session's list". Touch: `apps/engine/src/events`, `bookings`, `guest`,
`packages/contracts/src/event.ts` and `booking.ts`, the event pages and the
cockpit events and bookings pages. Size: 6 days. Depends on: 2 for paid
bookings. CEO: are free bookings with a deposit later acceptable for v1
(yes/no)?

### 5. Sign up and open a shop without a seeded persona

Why now: the first ten merchants cannot be seeded by hand forever, and the
onboarding agent is the demo. In: `POST /tenants` with email verification and
slug claim, owner in Cognito with the tenant claim, default pipeline and
onboarding flag, the subdomain live on publish, invitation of one staff
member, plan gate stubs (free tier limits enforced in the engine). Out:
billing, custom domains, data export, deletion. Journey: "a new merchant
signs up, talks to the onboarding agent, publishes, and a stranger buys from
the new subdomain, with no seeded persona involved". Touch: a new `tenants`
module in the engine, `packages/auth` (role set), `apps/web/app/signup`,
`docker/seed` (Cognito pool settings). Size: 6 days. Depends on: 1. CEO:
free-tier limit numbers (decision 2 says 30 orders or bookings a month).

### 6. Customers are not staff

Why now: today a buyer is a user in the tenant's Cognito pool with a role,
which self-serve signup would have to reproduce per shop; guest checkout
already created a ticket identity that wants a home. In: a `CUSTOMER#`
record per tenant with passwordless email-code sign-in on the storefront,
guest orders and bookings attached to the customer on first sign-in,
ownership checks on orders, bookings and threads moving to customer id,
the cockpit's buyer personas retired. Out: customer accounts across shops,
social login. Journey: "the guest who bought the mug signs in with a code
sent to that email and sees the order under Orders". Touch: `apps/engine/src/
guest` (becomes `customers`), `orders`, `bookings`, `threads`, `packages/
auth`, `apps/web/lib/auth`, the login page on shop hosts. Size: 7 days.
Depends on: 3 for the code email, 5 for tenant provisioning. CEO: none.

### 7. Plans and billing for the platform

Why now: the free tier is a promise the engine must keep, and the first paid
merchant has to be able to pay us. In: plan on the tenant record, gates in
the engine (orders per month, staff count, agents on Studio and above),
Razorpay Subscriptions for the platform fee, upgrade and downgrade, an
invoice list in the cockpit. Out: coupons, annual billing, dunning beyond one
retry. Journey: "a merchant on the free tier hits the order limit, upgrades
to Studio, and the next order goes through". Touch: `tenants`, a `billing`
module, `apps/web/app/(admin)/admin/settings`. Size: 5 days. Depends on: 5,
2. CEO: plan prices (decision 2).

### 8. The catalogue import agent

Why now: the fastest path from a maker's phone to a live catalogue is the
growth loop, and it uses the agents that are the reason to choose us. In:
paste a CSV or a list of lines, upload a folder of photos, the agent maps to
`POST /products/batch`, proposes registry fields it lacks through the
existing flow, and shows a preview the merchant confirms. Out: scraping a
live Instagram account, supplier feeds. Journey: "a merchant pastes twelve
lines of mugs and prices and confirms a catalogue of twelve products with
photos". Touch: `apps/agents/src` (a new graph), `apps/engine/src/products`
(batch exists), `apps/web/app/(admin)/admin/products`. Size: 5 days. Depends
on: nothing hard; better after 5. CEO: none.

### 9. Variants on one axis, and discount codes

Why now: a mug in three sizes is one product to a maker, and a launch code is
the first marketing move every merchant makes. In: `options` with one axis
(size or colour), `variants[]` with sku, price, stock, image; the order line
references the variant; the stock transaction conditions on the variant item
with the by-position rule intact; percentage and fixed discount codes with
usage limits applied by the engine at checkout. Out: two or three option
axes, automatic discounts, collections. Journey: "a stranger buys the large
mug with code LAUNCH10 and the seller sees the large mug's stock fall".
Touch: `packages/contracts/src/product.ts`, `order.ts`, `apps/engine/src/
products`, `orders/order-checkout.service.ts`, `cart`, a `discounts` module,
product and cart pages. Size: 8 days. Depends on: 2. CEO: one axis is enough
for the first hundred merchants (yes/no)?

### 10. Shipping and tax, flat and banded

Why now: an order total without shipping is a lie a merchant pays for. In:
shipping zones with flat and price-banded rates, inclusive or exclusive tax
per zone (GST for India), total as subtotal plus shipping plus tax minus
discount in minor units with the bounds rechecked. Out: carrier rates, label
purchase, tax services. Journey: "an order to another state shows shipping
and GST on the checkout and the seller's order page agree". Touch:
`packages/contracts/src/common.ts` and `order.ts`, `apps/engine/src/
orders/order-checkout.service.ts`, a `shipping` module, cart page. Size:
5 days. Depends on: 9. CEO: GST-inclusive display as the default (yes/no)?

### 11. Support agent that proposes actions

Why now: the order desk is where a solo merchant's evenings go, and the
propose-then-confirm pattern already exists. In: the support agent proposes
"refund order X", "move it to Ready", "resend the confirmation", each a
one-click confirm for the seller through the flow pattern; the buyer-facing
answer stays read-only. Out: autonomous actions. Journey: "the seller asks
what needs doing today and confirms two proposed stage moves". Touch:
`apps/agents/src/support`, `apps/engine/src/flows` (a new proposal kind),
cockpit orders page. Size: 4 days. Depends on: 2 for refunds. CEO: none.

### 12. Server-rendered shop shell

Why now: the storefront still paints nothing until three client fetches
resolve; a crawler gets metadata now but a slow phone gets a blank page.
In: the shop layout fetches config and theme on the server and streams the
shell; the client shell keeps interactivity; Lighthouse run and recorded.
Out: full static generation. Journey: "the shop's product grid is in the
first HTML response with no script run". Touch: `apps/web/app/(shop)/
layout.tsx` and `shop-shell.tsx`, `lib/server`, `lib/storefront-config`.
Size: 4 days. Depends on: nothing. CEO: none.

### 13. Cockpit on its own host

Why now: a storefront theme must never leak into the seller's tools, and the
CORS list should be a list of platform hosts. In: `admin.<platform>` serves
the cockpit; `/admin` on a shop host redirects there; the CORS list names it.
Out: separate deploys. Journey: "the seller's cockpit opens on the admin host
and the shop host's /admin sends them there". Touch: `apps/web/lib/shop/
shop-host.ts`, `(admin)/layout.tsx`, `docker/docker-compose.yml`. Size:
2 days. Depends on: 1 for the DNS. CEO: none.

### 14. Merchant alerts and low-stock

Why now: a merchant who is not in the cockpit needs to know an order came in.
In: a bell in the cockpit over a `NOTIFICATION#` item, email for new orders
and messages on a digest cadence, low-stock threshold per product. Out: push
notifications, SMS. Journey: "a new order rings the bell and the digest email
names it". Touch: `notifications`, cockpit shell. Size: 3 days. Depends on:
3. CEO: none.

### 15. Data export and shop deletion

Why now: a merchant who cannot leave will not arrive, and it is cheap while
the record shapes are still few. In: CSV and JSON export of products, orders,
bookings, customers; deletion with a seven-day cooling-off. Out: import from
other platforms (that is item 8). Journey: "a merchant exports their orders
and the file matches the engine's list". Touch: `tenants`, a `scripts/`
job. Size: 2 days. Depends on: 5. CEO: none.

### 16. Theme contract v2 and the section editor

Why now: after the first ten merchants ask, not before; decision 6 keeps
themes out of the headline. In: the section model with a schema version,
the registry of section components, add, remove, reorder in the cockpit,
preview links, three more presets (studio, bakery, atelier) screenshot-
verified. Out: third-party themes, twelve presets. Journey: "a merchant puts
classes above products on the home page and a stranger sees them first".
Touch: `packages/contracts/src/storefront.ts`, `apps/web/components`
(sections), `(admin)/admin/settings`. Size: 10 days. Depends on: 12. CEO:
none.

### 17. Webhooks and an API key per tenant

Why now: last, on purpose. In: signed webhooks for order, payment, booking
and product events through the SQS pattern; a per-tenant API key for the
existing read routes. Out: an app store. Journey: "a merchant's webhook
receives the order it just took". Touch: a `webhooks` module. Size: 4 days.
Depends on: 5. CEO: none.

### 18. Journey sharding in CI

Why now: the browser suites need the shared model; until a GPU runner
exists they stay local. In: split the journeys file by section, run the
sections that need no model in CI against the stack, keep the model-bound
sections local. Out: a self-hosted GPU runner. Size: 2 days. Depends on:
nothing. CEO: none.

## The first four weeks

Week 1: items 1 and 2 begin — the VM and Caddy on days one and two, then
Razorpay through day five with the webhook live on the real URL.

Week 2: item 2 finishes with refunds, then item 3 so a paying guest gets an
email; the twenty maker interviews from decision 6 happen in parallel and
feed item 4's scope.

Week 3: item 4, bookings a studio runs, sessions and staff first; one real
merchant is put through Razorpay onboarding to time it (risk 3).

Week 4: item 4 finishes with guest booking; item 13 (two days) so the first
merchant's cockpit is on its own host; the quarter's metric starts counting
with the first stranger's payment on a real shop.

Items 5 to 7 follow in weeks five to eight; items 8 to 11 in weeks nine to
twelve. The theme editor and webhooks are next quarter's.
