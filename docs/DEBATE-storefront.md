# Debate — the storefront: does the shop look like the merchant's?

**Date:** 2026-09-03 · A second debate, called because the first one
(`docs/DEBATE-surface.md`) ruled "the visual craft is good, the content is
wrong — no redesign this quarter" and the founder was not satisfied that the
ruling had been tested. Three roles argued it: a **design director**, a
**merchant** (Asha, a Kothrud potter who sells stoneware and teaches Saturday
glaze classes), and a **conversion lead** accountable for the fraction of
strangers who land and pay. The session refereed, checking each claim against
the code.

**New evidence, and it is what made this debate worth holding.** The first
debate looked at 24 screenshots of shops with *no published storefront* — the
seed has none, so every shot was the default teal theme. For this one, two
demo shops were published through the real API: `acme` as **Mitti Studio** on
the `artisan` preset (Fraunces, `#7a3b1e`, an uploaded hero photograph, an
About page) and `globex` as **Paperwala** on `editorial` (Playfair). Then the
whole buying path was photographed — grid, product, add-to-cart, cart, filled
cart, pay, confirmation, event, about, lookup — at 1440px and at 390px. 25
further screenshots. **The five presets shipped in August had never been seen
running before this evening.**

## The verdict on "the craft is good"

**True of the design system. False of the storefront as composed.** The split
does not run between cockpit and shop; it runs between *the parts* and *the
page*. The design director tried to break the first debate's ruling and broke
half of it in forty minutes.

The half that held: `components/about-sections.tsx` is twenty lines and
produces the one screen in either set that a stranger would believe belongs to
a pottery studio. `lib/theme/tokens.ts` carries measured contrast ratios and
the reasons for them. The WCAG `superRefine` in `contracts/src/storefront.ts`
and the axe gate over twelve page/theme combinations are real work and stay
untouched. **Nobody proposing a redesign here has opened the repository.**

The half that broke: **the theme barely reached the page.** Verified in the
tree, not inferred from pixels:

- `--mp-font-heading` was consumed by **three files in the whole web app** —
  `storefront-banner.tsx:36` and `about-sections.tsx:12,15`. A merchant who
  chose Fraunces got it on one headline and the About page. Her product names,
  her prices, her event titles, "Cart", "Payment" and "Order" were all Inter.
  We were selling a merchant a typeface and delivering a swatch.
- `shop-shell.tsx` handed the nested antd `ConfigProvider` **only**
  `colorPrimary` and `colorLink`, so every antd surface inside a themed shop
  kept the default `borderRadius: 10` against the preset's 6, Inter regardless
  of pairing, and `Table.headerBg: #f8fafc` — a cold blue-grey table head on a
  cream page, visible in `acme-desk-03-events.png`.
- `resolveTheme` overrode `--mp-hero-bg/-ink/-muted/-eyebrow` but **not**
  `--mp-hero-border`, which stayed `rgb(15 118 110 / 20%)`: a teal hairline
  drawn around a brown shop's banner.
- `.mp-announce` hardcoded `color: #ecfeff`, the default theme's cyan-tinted
  white, on every shop's announcement bar.
- `--mp-space-*` and the type scale are emitted once and never overridden, so
  all five presets share one rhythm and one ladder. `studio` and `market` are
  meant to be different densities and have no way to ask for one.

So the answer to "does 'artisan' look like a pottery studio" was: the hero
does, the About page does, **and nothing else did**. The rest was the same app
with a brown button.

## The merchant's answer: no, she would not send the link

Asha was asked whether she would forward the shop to her customers on WhatsApp
tonight and pay ₹999 a month for it. **No, and ₹0 today.** Her reasons, each
tied to a screenshot:

- **The shop had no name.** On the fully configured Mitti Studio, the masthead
  read "Marketplace" with the platform's logo — and because the About page is
  headed by `about.title`, the string "Mitti Studio" appeared *nowhere on the
  site at all*. Meanwhile `globex-mob-02-about.png` renders "Paperwala",
  proving the name was in the config and simply not wired to the header.
- **The pay page is card-only** — Card number / MM / YYYY / CVC, with the test
  card's helper text visible to the shopper. Her customers pay by UPI. Not
  friction: a stop.
- **Classes on a phone are a clipped table.** PRICE, BOOKED and any Book
  button sit off the right edge of a 390px viewport. Her ₹6,500 course is
  unreadable on the only device her customers use.
- **The event page is the least-finished screen in the product** — no
  photograph, no location, no description, a map-pin icon labelling the *end
  time*, and a "Sign in to book" wall. This is the stated wedge.
- **Checkout asks for no name and no phone number** — undeliverable in Pune —
  offers a Currency dropdown a shopper must handle, and shows UK placeholder
  addresses.
- **No footer anywhere**, on any of 25 screens: no address, no phone, no
  WhatsApp, no delivery or returns line.
- Public stock counts on every card; "Pick a demo persona" on the public
  sign-in; a Pour-Over Tasting Night on a pottery shop's events list.

Her price ladder: ₹0 today; ₹499 once name, rupees, UPI, phone and address,
a readable order number, guest booking and a footer land; ₹999 once the class
side works end to end; ₹2,999 only if it sells for her and handles GST and
courier. Her own arithmetic: ₹999 a month pays for itself at two extra class
bookings — a low bar the product is not near. What she praised, unprompted:
the artisan hero, guest checkout's "No account needed", and goods and classes
in one cart. Her sharpest note: **we shipped five presets before a phone-number
field.**

## The conversion lead's finding: a live fuse in week 1

Estimated funnel for 100 phone visitors from an Instagram link (informed
guesses, confidence stated per line): 100 land → 34 reach a product → 9 add to
cart → 6 start the form → 3 reach pay → **0–1 pay**.

The finding that mattered most was not an estimate. `cart/page.tsx` hardcoded
`initialValues={{ currency: 'USD' }}` and offered a `Select` of USD, EUR and
GBP — **INR was not selectable** — while
`orders/order-checkout.service.ts:76-82` throws `mixed-currency-order` when a
product's currency differs from the order's. The week-1 plan moves the seed to
rupees on day 3. **Every checkout on every demo shop would have failed**, with
a toast reading *"product X is priced in INR, order is in USD"*, and no
dropdown option could have fixed it — in the build the twenty maker interviews
were to be run against.

Also found, and confirmed:

- **The class path converts at exactly zero, not poorly.** "Sign in to book"
  leads to a login page, and there is **no sign-up route anywhere in the web
  app**. A stranger cannot obtain an account, so she cannot book. That is the
  positioning wedge, closed by a wall.
- **No phone number field exists anywhere on the buying path** — not in the
  checkout contract, not on the order record, not in any planned item. It is a
  hard dependency of Razorpay's `prefill.contact`.
- **Abandoning the pay page reserves stock forever**: the order is created
  `awaiting_payment` before payment, and a guest has no cancel route.
- Add to cart sits at ~773 CSS px on a 390px phone — below the fold — behind
  ~180px of chrome.
- The announcement bar promises "free shipping over $50" while the engine has
  no concept of shipping cost at all.

## What was settled, and what was built tonight

The referee's rulings, and the two commits that followed. Every claim below was
checked in the tree before it was acted on.

**1. The first debate's ruling stands, narrowed.** No redesign, no design
system, no framework swap — the merchant did not ask for a prettier shop, she
asked for *her* shop. But "the craft is good" was doing work it had not
earned: the system was good and unwired. The wiring is a day, and it was the
cheapest thing in either debate.

**Built** (`5a4fb23`): the shop's `ConfigProvider` now receives the resolved
variables — body font, three radii, borders, ink, surfaces and Table's header
colours; `--mp-font-heading` applied to the seven selectors that carry a
shop's voice; `--mp-hero-border` and `--mp-placeholder-ink` themed; the
announcement bar's cyan-white made white; the map pin on the end time made a
clock. Verified: Fraunces now sets "Sculpted Desk Lamp" and "$340.00" on the
artisan shop, Playfair sets "Events" and the masthead on the editorial one.

**2. The currency fuse is defused before it was ever lit.** The Currency
select is gone; the order takes the currency its cart is priced in, which is
the only value the engine would have accepted.

**Built** (`d6aae1c`), with the rest of week 1: `formatPrice` renders ₹340.00
and $74.00 across all thirteen price sites; the masthead, hero and crawler
title resolve the shop's name identically, so the search result and the header
can no longer disagree; the inventory band above the grid is gone and cards
say "In stock", "Only 4 left" or "Sold out"; a shop host has its own
not-found; a guest lookup that matches nothing says so; "View your shop" in
the cockpit; the false "photos can't be changed" caption deleted.

**3. The merchant's name outranked everything the designer wanted.** All three
roles arrived at it independently and it was half a day. It is done.

**4. Guest booking's status is upgraded from "gap" to "the wedge is
unreachable".** The first debate had it as a two-day item in week 2 because
`guest.controller.ts` has no booking route. The conversion lead found the
other half: there is no sign-up route either, so "Sign in to book" is not a
detour, it is a dead end for every stranger. Week 2 is unchanged in size and
now carries a different argument.

**5. The phone number is new work nobody had.** Not in the contract, not on
the record, not in any of the eighteen backlog items or the thirteen U-items.
Razorpay needs it, delivery needs it, and Asha's customers expect to be phoned
about a delivery. **Added to week 2 as half a day**, with the checkout field
order the conversion lead specified.

**6. UPI, not cards, is what the pay page must become.** Already week 3–4's
Razorpay work; the debate adds the requirement that UPI intent leads, the
amount is in rupees, and the shop's name is on the page.

**7. Deferred, with reasons.** The cart drawer (the design director's
highest-conversion request, 1 day) and the gallery wait for week 6 — the
buying path has to work before it is made pleasant. Per-preset spacing and a
display type step are next quarter: they are what makes five colourways into
five *presets*, and no merchant has asked. The storefront events table becomes
cards inside U4 in week 2, not as separate work.

**8. Where the roles were wrong.** The PM's earlier `U11` (empty states) was
already built — `empty-state.tsx` requires `description` and `action` by type
and thirteen pages use it. The design director's "the cockpit is fine" is
untested; nobody has photographed the cockpit on a phone since. The conversion
lead's claim that `H` (the home route) is over-valued because the hero already
renders above the grid is half right and half wrong: the hero does render, but
`app/page.tsx` is still five lines of `redirect('/products')`, so the front
door is a search results page with a filter rail down its left side.

## What is still true after tonight

The screenshots in `scratchpad/shots3` and `shots4` are the record of what
changed. What the merchant would still refuse to send tonight, in her order:

1. The pay page takes cards and not UPI. *(Week 3–4, Razorpay.)*
2. A stranger cannot book a class. *(Week 2, U3.)*
3. A class has no photograph, no place and no description. *(Week 2, U4.)*
4. There is no phone number field. *(Week 2, new, half a day.)*
5. There is no footer, so there is no way to reach the shop. *(Week 5, U2.)*
6. The front door is still the catalogue. *(Week 3, H.)*
7. The seed still sells kettles in dollars from Bristol. *(Week 1, S.)*

The position papers (three files, ~90 KB) stayed in the session scratchpad;
this document is the record.
