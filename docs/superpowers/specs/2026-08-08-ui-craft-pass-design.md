# UI craft pass

A second craft pass over the two shells. The professional-UI work fixed what
pages do when they have no data; this fixes what they look like when they do.
Every defect below was found by looking at the audit screenshots, not by reading
code, and every claim was then confirmed against the tree.

## Why

`test-results/audit` holds 51 screenshots across two themes and three viewports.
Reviewed by eye, they show an app whose page-level conventions are applied
unevenly: some destinations have a header, some do not; some records are named,
some are identified by a 26-character ULID; the storefront's one moment of scale
is mostly empty. None of these are failures — the tests pass and the axe suite is
clean. They are the difference between working and finished.

Verified defects, in the order a reader meets them:

- **Three storefront destinations have no header.** `/orders` (`D-06`),
  `/events` (`D-04`) and `/bookings` (`D-08`) render a bare table flush against
  the chrome — no title, no subtitle, no count. `/cart` has "Cart / 1 item ready
  to order". Every admin page has a title, a subtitle and its primary action.
  Every detail page has a back link and a title. Three of the five storefront
  destinations opt out of a convention the other two keep.

- **A finished list does not say so.** `CursorTable` renders "Load more" while
  `nextCursor` is non-null and renders nothing at all when it is. So a list that
  has reached its end looks identical to a list that is still loading its last
  page, and both trail off into 600–800px of empty page (`D-04`, `D-06`,
  `D-14`).

- **Lists lead with an identifier no human recognises.** `/orders` renders
  `id` as its first column at body weight — the widest and loudest thing in the
  row, and the least useful. `/flows` does the same.
  `apps/web/app/(shop)/orders/page.tsx:31` is the whole of it. `/bookings` is
  the worst case: `BOOKING` and `EVENT` are *both* full ULIDs, side by side,
  taking roughly 60% of the row between them (`D-08`), and neither names
  anything. Flow *detail* was retitled "Flow on {entity}" in `e66b7a6`; the idea
  was not generalised to the lists or to bookings.

- **Booking detail names a record by its foreign key.** `D-09` reads
  `Event: 01KZERNS77Z1E2HB509WV80MN6` where an event title belongs.

- **The hero is a wide band with content only on the left.** `.mp-hero` is a
  flex row whose single child `.mp-hero-text` is `flex: 1`, so the tenant name
  and three stat tiles sit against the left edge of a full-width slab and the
  remaining ~60% is gradient (`D-01`, `L-01`). Deleting `mp-hero-shot` in the
  previous pass removed the thing that used to occupy it.

- **Two `.mp-card-placeholder` rules disagree.** `components.css:487` sets
  `font-size: 26px; font-weight: 680`. `antd.css:49` sets
  `font-size: 24px; font-weight: 620; opacity: 0.75`. Equal specificity, and
  `antd.css` imports after `components.css`, so the second silently wins. This
  is fallout from the stylesheet split — two halves of one decision landed in
  two files.

- **The monogram fallback cannot hold its own beside a photograph.** A 24px
  glyph at 0.75 opacity on a flat gradient, in a grid where neighbouring cards
  carry full-bleed artwork, reads as a tile that failed rather than a tile
  without a photo (`D-01` rows 6–7, and worse in light theme, `L-01`).

- **The filter rail exposes an implementation term.** `filter-rail.tsx:32` and
  `:35` label two inputs "Min price (minor)" and "Max price (minor)". *Minor* is
  the currency-subunit term from the contracts. A shopper types 899 meaning
  £899 and filters for £8.99.

- **Flows attributes a change to a raw UUID.** `D-14`'s "Proposed by" column
  renders `5ce5a762-b117-4919-86c7-15359d701c49` at body weight, five times over.

Two things the screenshots show that are not defects:

- **`cheap-widget-39588-1786143786071`, `warranty1786143813286`,
  `e2e-launch-…`.** These are e2e fixtures in the audit tenant. They make review
  noisy but no UI change should chase them.
- **The large lettered product tiles.** `AE`, `SD`, `4M` are seeded *artwork*,
  not monograms — generated images with abstract shapes behind the initials. The
  CSS monogram is only the flat `C`/`D`/`I` fallback. The inconsistency is real;
  its cause is not a sizing bug.

## Constraints

Carried forward from `2026-08-08-professional-ui-design.md`, all still binding:

- **No engine changes.** No new route, no new field, no contract edit.
  `OrderResponseSchema` and `BookingResponseSchema` are `.strict()` and carry
  `productId` / `eventId` only — there are no titles in either payload, and this
  pass may not add them.
- **Cursor pagination gives no total.** Nothing here may display or imply one.
- **Ant Design stays.** Custom CSS extends and corrects it.
- **Attribute fields are tenant-defined.** No layout may assume a field name,
  count or type.
- **Both themes, always.**

Out of scope by decision, not by blocker: the chat page's empty proposal rail
and its card-in-card empty state. Chat is a different layout problem and gets
its own pass.

## Design

### Identity: demote the id, name what can be named

The rule, applied everywhere: **a ULID is never the primary column and never a
heading.** It is a reference — muted, monospace, short — and it appears last.

`/orders` columns become `Placed · Status · Items · Total · Ref`. "Placed"
carries the link, because when an order happened is the thing a buyer actually
recognises. `Ref` renders the last six characters in monospace at muted ink,
with the full ULID in `title` so it stays copyable and greppable.

`/flows` leads with `Entity` and `Adds` — what the flow changes, which is what
flow *detail* already says since `e66b7a6`. Flow id moves to a trailing `Ref`.
"Proposed by" gets the same treatment: `5ce5a762…` monospace and muted, full
value in `title`. `system:agents` already reads as a name and is left alone.

`/bookings` becomes `Booked · Status · Tickets · Ref`. The `EVENT` column is
removed rather than demoted: a second reference in the same row doubles the
noise and still names nothing, and the booking's own detail page — which does
resolve the event's title — is one click away. A row identifies one thing, not
two.

A shared `<Ref>` component owns this, so the four call sites cannot drift and a
fifth list gets it for free.

Booking detail resolves its event. The page already fetches one record; fetching
the referenced event to render its title is one more request on a single-record
page, which is a different cost from resolving names across a list. If that
fetch fails the panel falls back to `<Ref>` — a missing title must not take the
booking down with it. Lists resolve nothing: N requests per page, plus a
partial-failure state to design, buys less than it costs.

### Page headers

`/orders`, `/events` and `/bookings` get `PageHeader`, matching what `/cart` and
every admin page already do:

| Page | Title | Subtitle |
|---|---|---|
| `/orders` | Orders | Everything you have placed, at the prices they were locked at. |
| `/events` | Events | Sessions you can book a place at. |
| `/bookings` | Bookings | Places you have reserved. |

No counts in the subtitles. Cursor pagination cannot supply one and a count of
what happens to be loaded is a number that changes when you press "Load more".

### Closing a list

`CursorTable` gains a terminal state. When `done` is true and the list is not
empty, it renders a muted end-of-list line in place of the "Load more" button —
`{n} orders · end of list`, where *n* is what is loaded. This is honest under
cursor pagination: it counts what is on the page, and once `done` is true what
is on the page is all there is.

`CursorTable` is generic, so the noun comes from a required `noun` prop —
`{ one: 'order', many: 'orders' }` — alongside the `caption` it already takes.
Requiring it rather than defaulting to "item" is what stops the next list from
shipping a line that says "5 items · end of list" on a page about bookings.

The empty space below a short table is left alone. A five-row table on a tall
viewport is a short page; padding it to fill the fold would be decoration
standing in for content. The end-of-list line is what the reader was missing —
it says the list ended rather than leaving them to infer it.

### Hero

`.mp-hero-text` stops being the only child. The eyebrow and tenant name stay
left; `.mp-hero-stats` moves out to become a second flex child pinned right,
with `justify-content: space-between` on the container.

```
┌────────────────────────────────────────────────────────┐
│ ▣ STOREFRONT                                           │
│ acme                     20         6          18      │
│                        Showing  Categories  In stock   │
└────────────────────────────────────────────────────────┘
```

No new content and no new request — the same three figures the component
already computes from data the page has. Under the existing narrow breakpoint
the stats drop back beneath the name, which is what they do today.

### Product placeholder

Two steps, in this order, because they answer different questions.

**First, deduplicate with no visual change.** The `antd.css` copy is deleted —
that file's job is correcting Ant Design defaults, and `.mp-card-placeholder` is
our own component, so it belongs in `components.css` alone. The surviving
declaration takes the values that were actually rendering (`24px`, `620`, plus
the `opacity: 0.75` that existed only in the losing file). No pixel moves; the
split's accident simply becomes a decision, and the next change to this rule
has one place to happen.

**Then, restyle deliberately.** The fallback is strengthened so it reads as a
tile without a photo rather than a tile that failed: the glyph gains weight, the
blanket `opacity` goes (it was dimming the one element that carries the card's
only information), and the gradient picks up the same inner shadow the artwork
tiles have, so the two sit at comparable visual weight. The target is a grid
where a monogram card and a photographed card are neighbours without either
looking broken — judged from the screenshots in both themes, not from the CSS.

### Filter vocabulary

The two price inputs take **major units** and are labelled "Min price" and
"Max price", with the tenant's currency as the suffix where the rail knows it.
The form converts to minor units on submit using the same ×100 convention
`formatMoney` already divides by.

This changes behaviour, not just a label: a value that used to mean 899 subunits
now means 899 units. That is the point — the current control is a trap. Two
consequences to carry:

- `catalogue.spec.ts` fills the input by the label `Min price (minor)` and must
  be updated. `filter-rail.tsx:31` calls the label a contract; this pass changes
  the contract deliberately and updates the test in the same commit.
- The ×100 convention is wrong for zero-decimal currencies such as JPY. It is
  already wrong the same way in `formatMoney`, so this introduces no new defect
  and does not fix that one. Out of scope; worth a follow-up.

## Verification

Screenshots are the acceptance criterion. `zz-audit.spec.ts` already captures
both themes at three viewports; the pass is done when the affected captures have
been reviewed by eye, not when the suite goes green.

Specifically re-examined: `D-01`/`L-01` for the hero and the monogram grid,
`D-04`/`D-06`/`D-08` and their light counterparts for headers, the demoted
references and the end-of-list line, `D-09` for the resolved event title, `D-14`
for the demoted flow and author references, and the mobile captures for the
hero's stacked fallback.

Unit tests cover what a screenshot cannot: that `<Ref>` renders the last six
characters and carries the full value in `title`; that `CursorTable` renders the
end-of-list line only when `done` and non-empty, and never alongside "Load
more"; that booking detail falls back to `<Ref>` when the event fetch rejects;
that the filter rail submits `priceMinorMin` as major × 100.

`axe-core` continues to fail the suite on serious and critical violations. The
new muted reference ink is checked for 4.5:1 in both themes before it ships.

## Out of scope

- The chat proposal rail and its card-in-card empty state — its own pass.
- Resolving product or event names inside lists.
- Zero-decimal currency handling.
- Anything requiring an engine or contract change.
