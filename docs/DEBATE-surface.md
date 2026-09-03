# Debate — the surface: UI, onboarding, and what "improve everything" becomes

**Date:** 2026-09-03 · Three roles in two rounds — CEO, CTO and PM — each
writing from the same twenty-four full-page screenshots of the running stack
(desktop and a 390px phone, storefront on `acme.localhost:33002` and the
cockpit as `acme-admin`), the same four strategy documents, and the tree.
Round one was written blind; round two, after reading the other two. The
session then refereed the places they still disagreed, checking each ruling
against the code. The outcome is `docs/BACKLOG-surface.md`; the decisions it
rests on are appended to `docs/DECISIONS.md`.

The founder's brief was: improve the UI, the onboarding, everything — ahead
of the deployment and payments work. All three roles ended up refusing part
of that brief, for the same reason: **the product is not ugly, it is empty,
and it is branded with our name instead of the merchant's.**

## What the screenshots showed, agreed by all three

- The shop's home is the product grid. `app/page.tsx` is five lines of
  `redirect('/products')`; `mobile-home.png` and `mobile-products.png` are
  the same image.
- The masthead says **Marketplace** on every shop. `shop-header.tsx:69`
  hardcodes it, while `lib/server/shop-identity.ts:17` already resolves the
  real name for the crawler — the search result and the header disagree.
- Above the grid sits an inventory card: `STOREFRONT · acme · 6 Showing · 4
  Categories · 5 In stock`. Internal counters where merchandising should be;
  every product card publishes its stock count to the world.
- Prices read `340.00 USD` and the only order in the seed ships to Bristol,
  in a company whose decision 1 says the first ten merchants are in India.
  `lib/format.ts:76` asks `Intl` for fraction digits and then discards the
  symbol; `cart.service.ts:119` falls back to `'USD'`; currency is per
  product, and the dashboard refuses to sum across currencies.
- The wedge is the weakest screen. `mobile-events.png` is an antd table with
  PRICE and BOOKED clipped off the right edge of the phone. An event is
  title, capacity, two dates and a price: `CreateEventSchema` has no
  description, no location, no images, and `events.controller.ts` is
  `@Post`, `@Get`, `@Get(':id')` — there is no update route of any kind. An
  event is create-only and uncorrectable.
- `shop-06-event.png` says **Sign in to book**. `guest.controller.ts` guards
  cart, checkout, order, pay and lookup — seven routes, none of them a
  booking — and `lib/shop/commerce.ts` has no booking binding on either
  branch. Guest checkout shipped for mugs, not for classes, and classes are
  the positioning.
- The seller's orders list (`admin-04-orders.png`), the order page
  (`admin-11-order.png`) and the bookings page (`admin-06-bookings.png`) name
  no customer. The order page prints `line1:` and `postcode:` as labels.
  `guestEmail` is on every guest order and already reaches the admin read;
  nothing renders it.
- `products/new/page.tsx:79` tells every merchant "Add photos now — they
  can't be changed after the product is created". `UpdateProductSchema`
  has accepted `images` since it was written; only the edit form omits them.
- The cockpit's nav reads CATALOGUE / SALES / **SCHEMA** / SHOP; the
  assistant is titled "Schema assistant"; a flow row is attributed to
  `system:agents`; the storefront prints `Colour: —` for a field nobody
  filled in.
- The shop-host sign-in page (`shop-08-login.png`) shows our wordmark, a
  field labelled Username, and a public **Pick a demo persona** dropdown, to
  a merchant's customers.
- Settings has three cards and nowhere to put a shop name, logo, contact,
  address, policies, currency or a second staff member.

## What the code showed that the screenshots could not

**There is no tenant record.** `persistence/keys.ts` keys Product, Order,
Event, Booking, Flow and Message; `TENANT#<id>` is a partition-key prefix and
nothing else. The one place a shop's name exists is `businessProfile.name`
inside a `StorefrontConfig`, which exists only for a merchant who finished the
onboarding wizard. Nothing anywhere stores a currency, a logo, a timezone or
a **plan** — and decision 2's three plans cannot be charged for without a
field that says which one a merchant is on.

**The seed has no storefront config at all.** `docker/seed/fixtures/
catalogue.json` carries 28 records; the only `SETTINGS#` rows are one
announcement and the onboarding-dismissed flag. So all four demo shops render
the default theme, none of the five presets shipped in August is visible
anywhere in the running product, no shop has an About link, and the name
fallback everyone proposed renders `acme`. `heroStyle` in the contract is
read by nothing.

**The design system exists and is good.** `lib/theme/tokens.ts` emits one
palette twice, as antd `ThemeConfig` and as `--mp-*` variables, with measured
contrast ratios; tenant theming is bounded by a WCAG `superRefine` in the
contracts; an axe gate runs over twelve page/theme combinations;
`components/empty-state.tsx` exists, requires `description` and `action` by
type, and thirteen pages already use it. Two of the PM's round-one items —
"a new empty-state component" and a cockpit-wide phone pass — were withdrawn
or resized on this evidence. Nobody proposing a redesign has opened the
repository.

## Where they disagreed, and how it was settled

**Whether the surface goes ahead of the VM and Razorpay at all.** The CEO
refused the premise: item 1 (the real URL) stays first because every fix
below is unverifiable by a merchant on `localhost`, and
`NEXT_PUBLIC_PLATFORM_HOST` is baked into the browser bundle so per-shop
chrome is being tested on the wrong hostname until it lands. Razorpay moves,
but not far. Nobody argued for the PM's initial five-week slip, including the
PM by round two. *Settled: item 1 on days 1–2; Razorpay on days 15–19.*

**Guest booking.** All three found the hole independently; the argument was
placement. The CEO first put it inside Razorpay's week; the PM showed the
arithmetic does not close (five plus two in five) and that the failure mode
is not a lost checkout but a merchant concluding "nobody books classes
online" and running Saturday off WhatsApp for good — hitting ten shops on
goods in the quarter meant to prove we are not a goods platform. The CEO then
answered the question backlog item 4 had left open — **free bookings with
payment at the door are acceptable for v1** — which makes guest booking
revenue-relevant before a gateway exists. *Settled: 2 days, week 2, ahead of
Razorpay. At three days it goes behind.*

**The tenant record — whether, how big, and when.** The CEO bought it, on the
infrastructure budget, and added the fields decision 2 needs (`plan`,
`billingAnchor`, `platformBadge`, `agentBudget`, `billingRef`) stored and
unenforced; enforcement stays item 7. The CTO wanted it on days 4–5, before
any name work, so the fallback is built once. The PM wanted it in week 4 so
that week 1 ends with something on the internet. The referee's ruling: the
CTO's ordering constraint is real but costs half a day, not three — a
band-aid reading `businessProfile.name` from the storefront config, plus the
seed fixture the CTO found missing, gives the week-2 interviews a shop that
carries its name; the record lands in week 3 and the masthead is re-pointed
at it in half a day. `settingsSk()` is the storage seam, so the record is 2.5
days, not 4. *Settled: seed fixture and name band-aid in week 1; record in
week 3 with the plan fields; the rewire is the price of the interviews seeing
a named shop, and it is written here so it does not become permanent.*

**Events (U4): 2 days or 3.** The CTO's reasons held: `CreateEventSchema` is
`.strict()` wrapped in `.refine()`, so `UpdateEventSchema` cannot be derived
the way `UpdateProductSchema` was; there is no PATCH to extend; the image
tenant-slice check has to be re-proved for a second entity. The PM conceded
after reading the controller. *Settled: 3 days.*

**The attendance list (U7) and backlog item 4.** The PM claimed U4 and U7
absorb a day of item 4. The CTO verified half: description, location and
images sit on the parent event and sessions inherit them — real. The U7 half
is not: a booking points at an `eventId`, so an attendance view keyed on it
returns every attendee of a four-week course the day sessions land, and item
4's real cost — the capacity claim at a fixed transaction index in
`bookings.service.ts:108-131` under a "do not reorder" comment — is untouched
by either. U7 also depends on U3, not U4, because `BookingRecord` has no email
and `me.controller.ts` returns only the principal. *Settled: item 4 is 3.5
days, not 3; U7 is built in week 5 against `eventId` with a comment naming
the session migration, and item 4 rewrites it.*

**Onboarding (U9): 3 days, 5, or half a day.** The CTO traced the graph: the
START edge routes a `drafted` thread to `proposeTheme` and never back through
`interview`, so a "first product" step is a new phase, new pinned channels
and a new eval set — five days as written — and every feedback message
re-runs four to six structured model calls on a shared GPU whose cost per
conversation decision 4 requires measured before merchant two, and which has
not been measured. *Settled: the no-model half now (the checklist, "Publish
store" naming what it waits for, a cold-start notice), and the CTO's one-day
experiment — twenty scripted runs against the live daemon, cold and warm,
recording time to first draft and per feedback turn — before anyone prices
the graph work. Under 30s warm the shape is sound; over 90s the honest
product is a form with the model drafting copy behind it.*

**"Switch on what already exists."** The CEO's round-one premise was that the
hero, banners, presets and About page were free. The CTO traced it: banner
rendering is genuinely on (`products/page.tsx:45-47, 114, 191-192`), but
there is no home route to put a hero on, no banner form outside the wizard,
and no config in the seed. The banner editor was the second half the CTO
asked the CEO to cut, and it is cut: for now a merchant changes their hero
through the wizard, and that is said out loud. *Settled: a real home route
(1 day, with classes on it), the seed fixture (1 day), no banner editor this
quarter.*

**The cockpit on a phone (U5).** The PM's round-one item put stacked rows
inside `CursorTable` and paid six times; in round two he withdrew the cockpit
half as "1.5 weeks", misreading the CTO's number, which was 1.5 days across
eight call sites. The storefront half disappears anyway when U4 turns the
events table into cards. *Settled: `CursorTable` stacked rows in week 6 at
1.5 days; the storefront events table is U4's problem.*

**The variants kill criterion.** The CEO's "if the interviews rank variants
over investments 2 to 6" was replaced by the PM's countable form: more than
eight of twenty makers saying, unprompted, that they cannot list their goods
without sizes or colours. *Accepted.*

## What changed because of the debate

1. Backlog item 1 stays first; Razorpay moves to days 15–19, a two-week slip
   of the metric to the week of 5 October 2026 — not the PM's four.
2. Guest booking (2 days) and events that can be edited and wanted (3 days)
   land in week 2, so the twenty maker interviews look at a class with a
   photograph, a place, a rupee price and a Book button.
3. A tenant record exists from week 3, carrying identity and the plan fields
   decision 2 needs, unenforced.
4. The seed gets a published storefront per demo tenant; the five presets
   become visible for the first time; the four demo shops become Indian
   studios quoting rupees.
5. Money renders with a symbol from day 3.
6. The attendance list the CEO cut in `docs/DEBATE.md` is back, in week 5,
   ahead of item 4.
7. Item 9's variants stay out of the quarter, with a countable reopen.
8. No redesign, no design system, no framework swap, no free-form brand
   customisation, no theme editor and no banner editor this quarter.
9. One verification day at the end of week 4 for the serial local run of
   roughly 290 browser assertions, which nobody had costed.
10. A pre-committed stop: if no stranger has paid a real merchant through the
    platform by Monday 19 October 2026, all surface work stops that morning
    and decision 6 reopens.

The round-one and round-two position papers (six files, 165 KB) stayed in
the session's scratchpad; this document and `docs/BACKLOG-surface.md` are
the record.
