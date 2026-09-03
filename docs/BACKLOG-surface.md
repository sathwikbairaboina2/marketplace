# Backlog — the surface, sized and sequenced

**Date:** 2026-09-03 · The outcome of `docs/DEBATE-surface.md`. Sizes are
working days for one engineer who knows this codebase; the calibration is
unchanged from `docs/BACKLOG.md` — the guest checkout slice was one day and
forty files. Where a size below differs from a role's first estimate, the
debate says why. Items keep the `U` numbers the PM gave them so the debate
can be read against this list; `T` is the tenant record and `H` the home
route, which no role had as an item until round two.

This document supersedes the sequence in `docs/BACKLOG.md` for weeks 1 to 6.
The eighteen items there keep their numbers and their sizing record; the
section at the end says what each one loses or gains.

## The six weeks

Weeks run from Monday 7 September 2026. Every week names what a merchant can
verify at the end of it, because that — not the day count — is the test.

### Week 1 — the demo stops lying (5 days)

| Days | Item |
|---|---|
| 2.0 | **Backlog item 1** — rented VM, Compose stack, Caddy with wildcard TLS, nightly snapshots, the restore drill run once, the four seeded shops on their subdomains. First for a technical reason: `NEXT_PUBLIC_PLATFORM_HOST` is inlined into the browser bundle (`apps/web/lib/env.ts:19`), so per-shop chrome is being verified on the wrong hostname until this lands. |
| 0.5 | **U13a** — `formatMoney` renders a symbol (`lib/format.ts:76` moves to `style: 'currency'`); `cart.service.ts:119`'s `?? 'USD'` goes. Two hours of code, the rest re-shooting the campaign lines that assert on prices. |
| 1.0 | **S — the seed fixture** — a published `StorefrontConfig` per demo tenant, captured through the wizard as `docker/seed/catalogue.ts:14-17` requires, with real hero banners; the four shops become Indian studios with Indian addresses and rupee prices; a rupee announcement string. The first day on which any of the five presets is visible in the running product. |
| 0.5 | **U1a** — masthead, hero, `<title>`, `og:site_name` and JSON-LD read `businessProfile.name`, falling back to the slug; the `STOREFRONT · 6 Showing` band deleted. Three string sites; no test asserts the literal. Re-pointed at `T` in week 3. |
| 0.5 | **Cheap wins** — cards say "In stock / Low / Sold out" instead of a count; a `max-width: 767px` twin for `.mp-more-grid` (`pages.css:149-151`); a "View your shop" link in the cockpit; a shop-host `not-found.tsx`; a no-result state on the order lookup. |
| 0.5 | **U8** — the edit form renders `ImageUploader` and sends `images` on the PATCH; the caption at `products/new/page.tsx:79` deleted. `UpdateProductSchema` already accepts it. **The release valve:** if anything above runs long, this falls first. |

Verifiable: her shop is on a real subdomain, carries her name, quotes rupees,
does not publish her stock counts, and a bad photograph can be replaced.

### Week 2 — a stranger can book the thing we sell (5 days)

| Days | Item |
|---|---|
| 2.0 | **U3 — guest booking** |
| 3.0 | **U4 — an event is something a person can want** |

Verifiable: a workshop on a phone with a photograph, a place, a rupee price,
places left, and a Book button a stranger can press without a password. **The
twenty maker interviews look at this build**, on the deployed URL.

### Week 3 — the record, and the front door (5 days)

| Days | Item |
|---|---|
| 2.5 | **T — the tenant record** |
| 0.5 | **U1b** — masthead and metadata re-pointed at `T`; a shop that skipped the wizard now has a name. |
| 1.0 | **H — the home route** |
| 1.0 | **Backlog item 2 begins** — Razorpay order creation and the checkout handoff. |

Verifiable: every shop has a front door that is not a search results page,
and knows its own name even when the merchant never finished the wizard.

### Week 4 — take the money (5 days)

| Days | Item |
|---|---|
| 4.0 | **Backlog item 2 continues** — signed webhook as the source of truth for `paid`, reconciliation of `awaiting_payment` older than an hour, full refund with per-stage stock restore, UPI and cards. |
| 1.0 | **Verification** — one serial local run: the journeys (97, becoming about 112), the 160 campaign cases, the Playwright specs, the axe gate, and the human screenshot pass. Not negotiable; it was never costed before. |

Verifiable: a stranger pays with a test UPI id on a real URL and the seller
refunds it. **The quarter's metric starts counting the week of 5 October.**

### Week 5 — the merchant's side of the desk (5 days)

| Days | Item |
|---|---|
| 1.0 | **U6 — the order desk knows the customer** (shrunk) |
| 1.5 | **U7 — the attendance list** |
| 1.5 | **U2 — shop identity and footer** (shrunk by `T`) |
| 1.0 | **U10 — the cockpit speaks the merchant's language** |

Verifiable: Saturday morning, clay on her hands, she opens her phone and
reads six names and six emails.

### Week 6 — the first hour, the phone, and the measurement (5 days)

| Days | Item |
|---|---|
| 1.0 | **U9a — the first hour, without the model** |
| 1.0 | **M — the onboarding cost measurement** |
| 1.5 | **U5 — no cockpit table loses its price off a phone** |
| 0.5 | **U12a — the persona picker gated to the platform host** |
| 1.0 | Declared float. |

Verifiable: a merchant's first hour ends with a checklist that tells the
truth, and `docs/STATUS.md` carries the number decision 4 requires before
merchant two.

Weeks 7 onward resume `docs/BACKLOG.md`: item 3 (email) in week 7, item 12
(the SSR shell) in week 7 after U3 has settled in `shop-shell.tsx`, item 4
(sessions, 3.5 days) and item 5 (signup, now 4 days) in weeks 8–9.

## The items

### T. A tenant record

Outcome: the engine holds one row per shop that says who the shop is and what
plan it is on.

Why now: `TENANT#<id>` is a partition-key prefix, not an item. The shop's
name exists only inside a published `StorefrontConfig`, so a merchant who
pressed "Skip for now" has no name and nowhere to put one; currency is per
product; and decision 2's three plans have no field that says which one a
merchant is on. Backlog items 3, 5, 7 and 13 each need something from this
row; building it now makes four later items cheaper and stops the header and
the `<title>` disagreeing.

In: `TenantProfileSchema` beside `AnnouncementSchema` in
`packages/contracts/src/settings.ts`, stored at `SETTINGS#profile` through
`settingsSk()` — name, tagline, logo URL, contact email, phone, address
lines, default currency, timezone, locale, `showStock`; and, stored but
unenforced, `plan` (`free | studio | pro`) with its change date,
`billingAnchor`, `platformBadge`, `agentBudget`, `billingRef`. Admin read and
write; a public `GET /shops/:t/profile` through `ShopScope.run`; read
server-side in `app/(shop)/layout.tsx` so the name is in the first HTML byte.

Out: any counter, meter or gate (backlog item 7); the logo upload path (U2);
a `tenants` module — the settings seam is proven and 26 lines.

Journey: "a shop that never finished the wizard still knows its own name, in
the header and in the first HTML byte".

Touch: `packages/contracts/src/settings.ts`, `apps/engine/src/settings`,
`apps/engine/src/shops/shops.controller.ts`, `apps/web/app/(shop)/layout.tsx`,
`(admin)/admin/settings`.

Size: 2.5 days, infrastructure budget. Depends on: nothing. CEO: decided —
the plan fields are stored now and enforced in item 7.

### S. The seed carries a shop worth showing

Outcome: the four demo tenants have published storefronts, real banners,
Indian addresses and rupee prices, and the five presets are visible.

Why now: the seed has no `SETTINGS#storefront` row for any tenant, so every
demo shop renders the default theme, no About link exists, and the name
fallback renders `acme`. The week-2 interviews are shown the seed.

In: one captured `StorefrontConfig` per tenant, each on a different preset,
passing the strict schema and the WCAG refinement; hero and mid banners with
art; an About page; `businessProfile.name` set; every product and event and
the one order moved to INR with Indian addresses; the announcement in rupees.

Out: hand-edited JSON (the fixture must be captured, per the file's header).

Journey: the existing catalogue journeys, plus "every amount a shopper sees
carries the shop currency symbol, on the grid, the product, the cart and the
order".

Touch: `docker/seed/fixtures/catalogue.json`, `docker/seed/catalogue.ts`.

Size: 1 day. Depends on: U13a. CEO: the demo studio's name and city.

### U1. The shop carries the merchant's name, not ours

Outcome: a stranger sees the merchant's business name in the header, the
hero, the tab title and the Open Graph tag, and our name only as a footer
line on the free plan.

In: (a) week 1 — the three string sites read `businessProfile.name` with the
slug as fallback; the inventory band deleted. (b) week 3 — the same sites
read `T`, and the free-plan footer line reads `platformBadge`.

Out: logo (U2), custom domain, favicon, a shop-chosen font.

Journey: "the shop names itself: masthead, tab title and Open Graph all carry
the merchant name and never the platform wordmark".

Touch: `apps/web/components/shop-header.tsx`, the storefront hero in
`(shop)/products/page.tsx`, `lib/server/shop-identity.ts`,
`app/(shop)/layout.tsx`.

Size: 0.5 + 0.5 days. Depends on: S for the demo, T for the durable half.
CEO: decided — the badge is a line of text in the footer.

### U3. A stranger can book a class without an account

Outcome: the guest ticket that buys a mug also books a place at a class;
"Sign in to book" becomes "Book"; a booking taken online and paid at the door
is a booking.

Why now: decision 6 makes teaching the wedge, and the event page sends a
stranger to a Username field with a demo-persona dropdown. The CEO has
answered backlog item 4's open question: free bookings with payment later
are acceptable for v1, so this is revenue-relevant before Razorpay exists.

In: booking create and read under `/shops/:tenantId` on the existing
`GuestGuard`, running as `guest:<id>`; `guestEmail` on the booking as it is
on the order; the lookup extended so a reference plus an email finds a
booking; a booking binding in `lib/shop/commerce.ts` on both branches; a
confirmation page that shows the reference large and says to keep it; the
capacity transaction untouched.

Out: paid guest bookings (backlog item 2), guest cancellation, waitlists,
bookings in the goods cart, a confirmation email (backlog item 3, week 7).

Journey: "a stranger books two places at the Saturday workshop without ever
signing in" and "a stranger in a fresh browser finds that booking with its
reference and the email they gave".

Touch: `apps/engine/src/guest/guest.controller.ts` and `guest.guard.ts`,
`apps/engine/src/bookings`, `packages/contracts/src/booking.ts`,
`apps/web/lib/shop/commerce.ts`, `(shop)/events/[id]`, `(shop)/bookings`.

Size: 2 days. At three it goes behind Razorpay. Depends on: nothing.

### U4. An event is something a person can want

Outcome: an event carries a description, a place and photographs; it can be
corrected after it is created; the public events list is a card grid.

Why now: `CreateEventSchema` is title, capacity, two dates and a price, and
`events.controller.ts` has no update route — an event is create-only. The
phone events table clips PRICE off the viewport. Backlog item 4 assumes
these fields and does not budget them; sessions will inherit them from the
parent event.

In: `description`, `location` and `images[]` on the contract, with the
tenant-slice image check re-proved for a second entity; the base object
extracted so `UpdateEventSchema` can be built (`CreateEventSchema` is
`.strict()` wrapped in `.refine()`, `event.ts:10-26`); the events module's
first `PATCH /events/:id` with the admin guard and service check; a card grid
on `/events` with image, date, place, price and places left; description and
location on the event page; the seller's form gains the fields and the list
gains Edit, at a new `admin/events/[id]`.

Out: maps, recurring sessions and courses (item 4), ticket types, generated
artwork.

Journey: "a seller corrects a workshop description and start time after
saving it, and the shop shows the correction"; "a workshop carries a
photograph, a place and a description from the cockpit to a stranger's
phone"; "the events page at 390px shows every class price and its Book
button with no sideways scroll".

Touch: `packages/contracts/src/event.ts`, `apps/engine/src/events`,
`(shop)/events` and `events/[id]`, `(admin)/admin/events`, `events/new`, a
new `events/[id]`.

Size: 3 days. Depends on: nothing.

### H. The shop has a front door

Outcome: `/` on a shop host is a home page — hero, featured products, the
next three classes, an About teaser — and `/products` is the catalogue.

Why now: `app/page.tsx` is `redirect('/products')`; there is no route to put
a hero on that is not a search results page. Banner rendering is already on;
what is missing is the page. Classes on the front door is decision 6 made
visible.

In: a fixed section stack over `banners[]`, `about.sections`, `sellsWhat` and
the events list; the About link in the nav whenever a config exists.

Out: a section editor (backlog item 16), a banner form outside the wizard —
for now a merchant changes their hero through the wizard, and the cockpit
says so.

Journey: "the shop front door shows the merchant hero, the featured products
and the next three classes, not a filter rail".

Touch: `apps/web/app/page.tsx` (becomes a page), `components/shop-header.tsx`.

Size: 1 day. Depends on: S, U4. Consumes 3 of backlog item 16's 10 days as
the CEO wrote it.

### U13. Prices read like money where the merchant lives

In: (a) week 1 — the formatter renders a symbol and the cart's USD fallback
goes. (b) with `T` — `defaultCurrency` on the profile, taken by the product
and event forms and hidden unless multi-currency is switched on.

Out: multi-currency checkout, FX, per-region pricing.

Journey: "a merchant whose shop currency is INR creates a product without
touching a currency field, and the storefront, the cart, the order page and
the dashboard all render ₹ and agree on the total".

Touch: `apps/web/lib/format.ts`, `apps/engine/src/cart/cart.service.ts`, the
product and event forms, `T`.

Size: 0.5 + 0.5 days. Depends on: T for (b). CEO: single-currency per shop is
enough for the first hundred merchants.

### U6. The order desk knows who the customer is

In (week 5, shrunk): a Customer column on the orders list showing the account
name or the guest email — `guestEmail` already reaches the admin read through
`order-response.ts:15`; a customer block on the order page with the address
under human labels; the stage-advance control; the reference in the heading.

Out until backlog item 8 makes a list long enough: the stage filter, search
by reference or email.

Journey: "a seller reads the buyer email off the order a stranger placed,
advances it one stage, and the buyer sees it move".

Touch: `(admin)/admin/orders` and `orders/[id]`.

Size: 1 day. Depends on: nothing.

### U7. The attendance list a studio actually needs

In: `guestEmail` on the booking read; an Attendees view per event at
`admin/events/[id]`, ordered by booking time, with a places total; upcoming
separated from past on Bookings; a print stylesheet. Built against
`eventId`, with a comment naming the session migration that backlog item 4
will make, because a booking points at an event and sessions will change
what "who is coming Saturday" means.

Out: check-in, CSV export (item 15), sessions and staff (item 4).

Journey: "a seller opens the Saturday workshop from the events list and
reads three attendees by name and email".

Touch: `(admin)/admin/bookings`, `admin/events/[id]`,
`apps/engine/src/bookings` (`GET /bookings/all` gains an event filter through
the repository's `FilterSpec`).

Size: 1.5 days. Depends on: U3 (the email), U4 (the page it hangs off).

### U2. A shop identity a merchant can fill in

In: a "Your shop" card in Settings over `TenantProfileSchema`; a footer on
every `(shop)` route with contact and free-text shipping and returns, aware
that `shop-shell.tsx:68` returns null until config resolves; the logo upload
into the tenant's media slice, reusing the product upload's checks.

Out: structured hours, GSTIN, policy templates, a contact form.

Journey: "the merchant saves a contact number and a returns note and a
stranger reads both in the footer of a product page".

Touch: `(admin)/admin/settings`, a new `components/shop-footer.tsx`,
`components/shop-shell.tsx`, `apps/engine/src/uploads`.

Size: 1.5 days. Depends on: T. CEO: decided — free text is fine for v1.

### U10. The cockpit speaks the merchant's language

In: SCHEMA / Flows / Chat becomes Custom fields / Field history / Add a
field; each flow row described in a sentence; the raw `gathering` badge
gone; registry labels humanised on forms and reads; a registry field with no
value omitted on the storefront instead of `Colour: —`.

Journey: "no cockpit page prints the words schema, entity, flow or
system:agents, and a product with no colour shows no Colour row".

Touch: `(admin)/admin/flows` and `chat`, the admin nav in
`components/admin-shell.tsx`, the registry renderers, `(shop)/products/[id]`.

Size: 1 day. Depends on: nothing.

### U9a. A first hour that tells the truth

In: three worked openings in merchants' own words; a visible four-step
spine; "Publish store" naming what it is waiting for instead of being
silently disabled; the preview pane saying the model is thinking and that a
cold start is about forty-five seconds; a "Finish setting up — n of 5"
checklist on Dashboard and Products driven by real state. No model calls
added.

Out: the first-product step inside the graph (U9b, 2 days, unscheduled until
M has a number).

Journey: "a fresh owner picks a worked opening, watches four named steps,
and is told what Publish is waiting for".

Touch: `(admin)/admin/onboarding`, a new checklist component,
`(admin)/admin/dashboard`, `products`.

Size: 1 day. Depends on: nothing.

### M. What an onboarding conversation costs

In: twenty scripted runs of the onboarding graph against `research-ollama`,
ten cold and ten warm, over five business descriptions written the way our
merchants talk; wall-clock to first draft, wall-clock per feedback turn,
tokens per conversation; the numbers into `docs/STATUS.md`. The harness is
the existing scripted-provider int-test pointed at the live provider.

Decides: under 30s warm, U9b is priced and scheduled; over 90s, onboarding
becomes a form with the model drafting copy behind it, which is a different
and cheaper item. Decision 4 requires this before merchant two.

Size: 1 day. Depends on: nothing.

### U5. No cockpit table loses its price off a phone

In: a stacked-row rendering in `components/cursor-table.tsx` below `sm`,
across its eight call sites; a phone-width campaign case with a screenshot
for each.

Size: 1.5 days. Depends on: nothing. The storefront events table is fixed by
U4 and is not counted here.

### U12a. The demo persona picker is not on a merchant's shop

In: `app/api/personas` gated on the platform host behind a dev flag; the
shop-host login shows the shop's name from `T`. The rest of U12 — the shop's
theme on the card, Email not Username, links back — waits for backlog item
6, which owns customer identity.

Size: 0.5 days. Depends on: T.

## What this does to `docs/BACKLOG.md`

- **Item 1** unchanged, days 1–2.
- **Item 2** unchanged in scope, days 15–19; the metric starts the week of
  5 October rather than 28 September.
- **Item 3** (email) to week 7; guest bookings do not wait on it.
- **Item 4** loses guest booking to U3 and the attendance list to U7; gains
  description, location and images from U4; keeps sessions, courses and
  staff, and the capacity-claim rewrite that was most of its cost. **3.5
  days**, week 8; it rewrites U7's view for sessions.
- **Item 5** (signup) drops from 6 days to 4: `T` supplies the tenant row,
  the slug and the plan field.
- **Item 6** loses a day to U6.
- **Item 7** (billing) enforces fields `T` already stores.
- **Item 9** variants: next quarter; reopens for week 9 if more than eight of
  twenty makers say, unprompted, that they cannot list goods without sizes
  or colours.
- **Item 12** (SSR shell) to week 7, after U3 has settled in
  `shop-shell.tsx` — the same file cannot take a new guest binding and a
  rewrite in the same six weeks.
- **Item 13** next quarter.
- **Item 16** loses 3 of 10 days to H; the other 7 next quarter.
- **Items 15, 17** next quarter, as before.

## Decisions the founder owes this week

1. Razorpay on days 15–19, not days 1–5 — confirm. Everything in weeks 2 and
   3 hangs on it.
2. A class booked online and paid at the door, confirmed by a reference on a
   page with no email until week 7 — confirm.
3. The banner editor is cut: a merchant changes their hero through the
   wizard this quarter — confirm.
4. The twenty interviews run against the deployed URL, not `localhost` —
   confirm. If not, day 3 of week 1 (the seed) goes to U6 instead.
5. The founder-run demo studio's name and city, so the seed and every
   screenshot the interviews see can be a real Indian studio and not `acme`.
6. The domain to buy — still open from `docs/BACKLOG.md` item 1.
