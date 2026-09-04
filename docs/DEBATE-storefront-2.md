# Debate — the storefront, round 3: can a merchant sell on it?

**Date:** 2026-09-04 · The third storefront debate, and the first with a role
who had not been in the room before. Round 1 (`docs/DEBATE-surface.md`) ruled
"the craft is good, the content is wrong". Round 2 (`docs/DEBATE-storefront.md`)
broke half of that — the design system was good and **unwired** — and the
wiring shipped that night (`5a4fb23`, `d6aae1c`). This round was called to find
what is newly true now that the theme reaches the page and the buying path
completes end to end.

Four roles argued it: a **design director**, a **conversion lead**, the same
**merchant** (Asha, the Kothrud potter), and a **retail merchandising lead** —
the new voice, called specifically because two rounds of debate had produced no
item about whether a merchant can *merchandise* at all. The session refereed,
and every claim below was re-checked in the tree before it was recorded.

## The evidence, and what is wrong with it

32 screenshots, captured this afternoon against the running stack: two shops
published through `PUT /storefront/draft` + `POST /storefront/publish` — `acme`
as **Mitti Studio** (artisan, Fraunces, `#7a3b1e`) and `globex` as **Paperwala**
(editorial, Playfair) — and the whole stranger's path photographed at 1440px and
390px, front door through confirmation.

Two contaminations, stated up front because three roles tripped over them:

- **The seed still sells kettles in dollars from Bristol.** Every screenshot
  shows a Pune potter quoting `$340.00` for a desk lamp. Round 1's evidence was
  contaminated by unpublished storefronts; this round's is contaminated by the
  catalogue. Structural claims survive it. **Nothing any role said about tone or
  warmth should be trusted until the rupee seed lands.** This is week 1 item S,
  and it is now blocking the ability to hold a debate, not just a demo.
- **The hero has no photograph because the capture published `art: {kind:'css'}`**,
  not because the product lost one. The merchant's complaint that "the artisan
  hero renders with no photograph despite one being uploaded" is the referee's
  bug in the capture script, and is struck from the record.

## The finding that reorders the backlog

**The guest can be locked out of the order they are standing in front of, and
the brightest button on the screen is what locks them out.** The conversion lead
found it by reading; the referee re-verified every link in the chain.

- The guest principal *is* the ticket: `guest.guard.ts:33` derives `userId` from
  the ticket in the `x-guest` header.
- Paying requires that principal: `order-payment.service.ts:31` answers 404
  unless `found.userId === currentPrincipal().userId`.
- Signing in spends the ticket unconditionally — `commerce.ts:58`, in a `finally`
  — and `cart-context.tsx:54` runs that on every binding change. The behaviour
  is inherited: the login page did the same thing before today's `807c4d2` moved
  it, so this is a hole that has been open since guest checkout shipped, not a
  regression.
- Sign in is `type="primary"` (`shop-header.tsx:135`) — the one filled pill above
  the fold in every mobile capture, **present on the pay page**.
- The order *is* reachable afterwards, by email: `orders/[id]/page.tsx:48-50`
  branches to `lookupOrder`. The pay page has no such branch (`pay/page.tsx:25`),
  and the "Pay now" button at `:213` drops the email on the way there.
- She cannot cancel either. `guest.controller.ts` publishes eight routes and
  cancel is not one of them, while `order-lifecycle.service.ts:140` says in a
  comment that an unpaid order "is always cancellable: no money has moved, no
  stage has begun, and **holding the stock helps nobody**".
- And the stock is held: `order-checkout.service.ts:151-173` takes it before
  payment, and a `grep` for `awaiting_payment` finds no sweeper.

So: a stranger interrupted on the pay page taps the brightest button, or comes
back in another browser. Her order is now unpayable by any route, uncancellable
by her, and her mug is off sale until the merchant cancels a ghost order by
hand. Four of those on an "Only 4 left" product take it off the shop. The
conversion lead estimates 10–25% of guest checkouts that are not completed in
one sitting; the referee accepts the mechanism and not the number.

**Ruling: this is week 2's first day, ahead of everything else in this
document.** Three parts, one day: do not spend the ticket while an unpaid order
exists; let the lookup email authenticate the pay route; give guests the cancel
the engine already believes they should have.

## The priority inversion: we shipped guest checkout before we knew who a customer is

Round 2's most useful merchant finding was "we shipped five presets before a
phone-number field". This round's is sharper.

**Seventy per cent of Asha's money is repeat business.** Priya buys two mugs in
March, breaks one in July, and messages *"the same one, the speckled glaze"*. In
this product, July-Priya is a brand-new stranger: there is no customer record,
and order lookup needs a 26-character ULID she deleted in March. **Guest
checkout optimises the first sale and forecloses the second**, and the second is
where the merchant's rent comes from.

The merchant's four unasked-about cases, each of which the product has no shape
for:

- Every piece is one-of-one, so **"Sold out" is the normal state**, and what she
  needs is "tell me when the next one is fired" (she prices this at ~₹5,600/mo).
- Half her orders are **collected at the studio**, and checkout forces a fake
  address (~₹1,200/mo).
- A ₹12,000 plate set needs **half now, half on delivery** (₹25–36k/mo of
  revenue with no shape here at all).
- Two seats left on Thursday: the product can *take* a booking but cannot
  **cause** one.

The referee's ruling: **the customer record is real and it is not this month's
work.** It is the strongest argument yet produced for what comes after launch,
and it goes to `docs/ROADMAP.md` as a named theme rather than into a week. What
*does* move now is its cheapest precondition — a human-readable order number
(`MS-0041`, not `01M1NW5KEMAH79GE53SQYQ65WQ`), which is half a day and which the
merchant, the conversion lead and round 2 all asked for independently.

## The merchandising lead's finding: she cannot arrange her own shop window

The new role earned its seat. Established from the code, not the pixels:

- **Ordering is a timestamp, and it is backwards.** The grid is `queryPrefix` on
  `PRODUCT#` with `ScanIndexForward: false` (`dynamo.repository.ts:145`) over
  ULID sort keys — strictly newest-listed first. No `featured`, `pinned` or
  `sortIndex` on `CreateProductSchema` (`product.ts:7-22`, and it is `.strict()`),
  no sort control for shoppers, no reorder in the cockpit.
  **Consequence, visible in every capture: the sold-out $340 desk lamp holds
  position 1 of the shop.**
- **There is no URL between "the whole shop" and "one product".** `category` is
  already a public server-side filter (`shops.controller.ts:77-86`) and is
  printed on every card (`product-card.tsx:37`) — and is not a link. Filter state
  is `useState` (`products/page.tsx:54`) with no `useSearchParams` anywhere.
  Proof: `acme-desk-01-front-door.png`, `acme-desk-02-grid.png` and
  `acme-desk-13-search.png` — the last of which was captured at `?q=bowl` — are
  **byte-identical**, `md5 e02537c50a58895244e23aaf00a14b4a`. The merchant's
  entire distribution is one Instagram link, and the only link she owns opens a
  page ordered by a timestamp that she cannot address, filter or narrow.
- **`MoreFromShop` is the grid again**, `listProducts(8)` minus self sliced to 4
  (`more-from-shop.tsx:20-23`) — so the sold-out lamp leads the cross-sell too.
- **A product carries 20 images** (`product.ts:18`) and every one of the three
  render sites draws `images[0]`. No variants. `stock` is a plain count, and `0`
  disables Add to cart (`product-detail.tsx:103,112`), so a made-to-order maker
  must type a fictional number.
- **Search** is `contains()` over one lowercased blob (`product.ts:58-62`).
- **Classes carry no image, description or location** (`event.ts:13-27`) and the
  events list publishes **"22 of 24 places left"** — scarcity inverted, on the
  highest-margin line in the shop.

**Objection sustained against a funded item:** `BACKLOG-surface.md` funds item H
("featured products", 1 day) with no field to read, so it would ship as "the four
newest" — `MoreFromShop` a second time. H needs the pin underneath it or it is
not H.

## The design director's finding: the wiring stopped one layer short

Round 2 wired the *heading* font and declared the theme delivered. It is not.

- `body` hardcodes `var(--font-inter)` (`base.css`), `.mp-shop`
  (`components.css:56`) sets **no** `font-family`, and `--mp-font-body` — emitted
  by `resolve.ts:65` — reaches exactly **one** CSS rule, `components.css:377`,
  an about-page paragraph. Verified by grep over the source. So a shop's body
  text is Inter whatever the merchant chose. The `market` preset defaults to
  `nunito`/`nunito`, which means it currently gets Nunito on antd controls (via
  the ConfigProvider at `shop-shell.tsx:106`) and **Inter on every paragraph** —
  a split body face. Invisible so far only because no `market` shop has ever been
  photographed. **Fix: one declaration. 0.25 day.**
- The shop's `ConfigProvider` (`shop-shell.tsx:103-124`) passes primary, link,
  font, three radii, borders, ink, surfaces and Table — and **no**
  `colorInfo/Success/Warning/Error`, while `resolve.ts:48-50` resolves a per-preset
  olive `--mp-success` and hands it to nobody. That is antd's `#e6f4ff` blue box
  on the cream confirmation page, and a stock-green tick on the add-to-cart toast.
  **0.5 day.**
- **Five presets are still one preset in everything but colour.**
  `resolve.ts:32-66` returns 33 overrides and none is `--mp-space-*` or
  `--mp-text-*`; `Preset` (`presets.ts:54-64`) has fourteen colour fields and no
  spacing, type or density. `acme-desk-11-about.png` and `globex-desk-11-about.png`
  share measure, offset, heading sizes and gaps exactly. Round 2 deferred this to
  next quarter; the CSS is already 78% tokenised on font-size and 88% on spacing,
  which makes it **2 days, not a quarter**. The shop's body text is also **14px**,
  the cockpit's size, on a consumer storefront.
- **Product not-found shows a stranger a cockpit component.**
  `acme-mob-14-not-found.png`: a red X, a **trace id printed twice**, a "Try
  again" that fails forever, no way back, and a toast over the masthead —
  because `product-detail.tsx:46` renders `ErrorPanel`, whose own copy reads
  "This console and the service disagree" (`error-panel.tsx:52`). `ProblemError`
  carries `status` (`http.ts:24`), so routing 404 to `EmptyState` is one
  predicate. **0.5 day.**

## Rulings

**1. The fuse is week 2 day 1.** One day, three parts, above everything else
here. A payment path that can lock out the person holding the money is not a
polish item.

**2. The unwired layer finishes before anything new is built.** Body font,
antd status colours, the 404, and dropping `type="primary"` off Sign in — about
forty lines across five files, **one day together**. Round 2 shipped the wiring
and the wiring was not finished; building a front door first means photographing
a new page with the old defects on it. All three roles who looked at the code
arrived here independently.

**3. India-first has not reached the cockpit.** The referee's own finding while
checking the merchandising claims: `admin/products/new/page.tsx:128` and
`admin/events/new/page.tsx:68` offer a `Select` of **USD, EUR, GBP**. Round 2
fixed the *buyer's* currency select and nobody looked at the *seller's*. In an
India-first product a merchant cannot price anything in rupees.
**0.25 day, and it is embarrassing.**

**4. Sold-out sorts last, and the pin comes with it.** Ten lines in `listVisible`
fixes every screenshot in this document with no merchant action required
(0.25 day). The merchant-controlled pin is 1.5 days and must land under item H
before H is built. The merchandising lead costed a full `Collection` entity at
4–5 days and **abandoned it**: `category` is already a curated, named group the
merchant already types, and what she needs from it is an address — which
`?category=` gives for 1.5 days.

**5. URL-addressable filter state is the cheapest distribution the merchant will
ever get.** Three byte-identical screenshots is the whole argument. 1.5 days,
web-only, the engine filter already exists and is public.

**6. Guest booking's status is unchanged and its argument is now arithmetic.**
The merchant prices two to three class seats a month at ₹13,000–19,500 —
13–20× the ₹999 fee, from the product's stated wedge, which today converts at
exactly zero: a login wall in front of an app with **no signup route**, and no
guest booking route behind it. Round 2 funded it at 3 days in week 2. It stays,
and it is the largest single revenue item anyone has put a number on.

**7. Per-preset spacing and type move from next quarter into next month**, at
2 days, on the design director's cost evidence. Not because a merchant asked —
none has — but because five colourways are not five presets, and this is what
the product is being sold as.

**8. The customer record is post-launch, and it is named.** See the inversion
above. Its precondition, a human-readable order number, is half a day and moves
now.

**9. The front door stays where round 2 put it** (week 3, item H), at 1.5 days
rather than 1: `shop-shell.tsx:68` returns `null` until the client config
resolves, so a server-rendered front door is more than a route. Nothing in the
shop links to `/` today (`shop-header.tsx:67` points the brand at `/products`),
so it disturbs no journey, and `products/page.tsx:190-191` already renders the
`mid` and `footer` banner bands, so the composition primitive exists and is
empty.

## The enhancements, ranked, with what they cost

**Now — 3 days, and nothing new is built until these are done**

| | Item | Cost |
|---|---|---|
| 1 | Guest lockout: keep the ticket while an order is unpaid; email-authenticate the pay route; a guest cancel | 1 d |
| 2 | The unwired layer: `--mp-font-body` on `.mp-shop`, antd status tokens, 404 → `EmptyState`, Sign in loses `type="primary"` | 1 d |
| 3 | INR in the cockpit's product and event forms | 0.25 d |
| 4 | Sold-out sorts last, in `listVisible` and in `MoreFromShop` | 0.5 d |
| 5 | Human-readable order number | 0.5 d |

**Next — the month**

| | Item | Cost |
|---|---|---|
| 6 | Guest class booking + a real event page (photo, place, description, cards not a table) | 3 d |
| 7 | Sticky action bar below 991px — `.mp-summary` is `sticky` on desktop and `static` on the phone (`pages.css:377-388`); Checkout sits 178px below the fold | 0.5 d |
| 8 | URL-addressable filters, and category chips that are links | 1.5 d |
| 9 | Buyer name + phone, Indian address placeholders, rupee seed | 1 d |
| 10 | Per-preset spacing, type scale, a display step, and a 16px shop base | 2 d |
| 11 | Merchant pin, with the cockpit toggle — underneath item H | 1.5 d |
| 12 | A footer, on all 32 screens | 0.5 d |
| 13 | Small defects: address printed backwards (`orders/[id]/page.tsx:277`), sold-out reported as a ULID (`order-checkout.service.ts:263`), the `active` pill leaking to shoppers (`product-detail.tsx:85`), `MoreFromShop` selection, the events list's inverted scarcity | 1 d |

**Named, not scheduled:** the customer record and repeat purchase; "tell me when
the next one is fired"; collection at the studio instead of delivery; part
payment; the product gallery; variants.

## Where each role was wrong

- **The design director** expected round 2's heading-font work to have made the
  two shops look different, and two checksums ended that. He then picked the one
  preset pair that *cannot* differ on the only non-colour axis presets have —
  `presets.ts:88,135` give both `artisan` and `editorial` `defaultRadius: 'sharp'` —
  so his general claim narrows to spacing and type. He was going to blame
  `tokens.ts` for the blue Alert; the tokens are right and the wire is missing.
  He framed the single-image product as data loss and had to walk it back to a
  loss waiting to happen. And he arrived wanting to build a hero system that
  `products/page.tsx:190-191` shows already exists.
- **The conversion lead** assumed a stale cart price made `price-changed` an
  unrecoverable loop; the engine re-reads and conditions on the fresh price
  (`order-checkout.service.ts:68-87,168`), so the window is milliseconds, and he
  deleted a half-written proposal. He expected a declined card to strand the
  shopper; `pay/page.tsx:60-70` handles it inline and the 402 never touches the
  order. He repeated the merchant's "the events table is clipped and the price is
  unreachable" — `cursor-table.tsx:106` sets `scroll={{x:'max-content'}}`, so the
  right criticism is that there is no affordance, not that it is impossible. And
  he had been scoring theme work as conversion work: Add to cart is still at
  753px because neither storefront commit touched that layout.
- **The merchandising lead** costed the `Collection` entity his field always asks
  for and abandoned it, then argued the *opposite* of his instinct on faceted
  search — hide the filter rail below ~12 products, because at six it is 240px of
  chrome filtering a set the eye reads at a glance. He dropped variants, partly on
  cost and partly because three glazes are three objects that each deserve a
  photograph. He dropped a recommendation engine in favour of three lines of
  selection logic.
- **The merchant** was wrong about the hero photograph, which was the referee's
  capture bug and not the product's. Her ladder otherwise tightened rather than
  moved: of eight conditions for ₹499, two shipped, and she is now three items
  away — UPI, a phone field, guest booking — with a written commitment to pay
  ₹499 the month those land and ₹999 the month a class fills through the site.
- **The referee** published both demo shops with `art: {kind:'css'}` and let four
  roles argue over a hero with no photograph in it.

## What the merchant would still refuse to send tonight

Her answer to "would you forward this link to your customers": **no, and ₹0 this
month** — the same words as round 2, for a shorter list.

1. The pay page is card-only, with the test card's digits printed for the
   shopper to read. *(Week 3–4, Razorpay.)*
2. A stranger cannot book a class. *(Week 2.)*
3. There is no phone number field, so the courier refuses the parcel.
   *(Week 2.)*
4. The order number is a ULID. *(Now, ruling 8.)*
5. There is no footer, so there is no way to reach the shop. *(Week 5.)*

What she praised, unprompted: the About page is the only screen in the product
that sounds like a person, and it goes in her Instagram bio tonight; her name
and her typeface finally reach the page; killing the public stock count was
exactly right; "No account needed" is a sentence she would say herself; and
goods and classes in one cart is still the thing nobody else offers her.

The four position papers (~99 KB) stayed in the session scratchpad. This
document is the record.
