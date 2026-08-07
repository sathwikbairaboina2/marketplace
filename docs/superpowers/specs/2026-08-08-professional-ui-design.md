# Professional UI

A craft pass over both console shells: fix the layout and state defects that make
the app read as unfinished, then give it the foundation — state coverage,
accessibility, motion — that keeps it finished as it grows.

## Why

The visual identity work landed a palette, a dark mode, two shells and a set of
components, and the uncommitted working tree adds a two-column product detail, a
two-column cart, formatting utilities and a rebuilt schema-assistant chat. What
neither landed is what happens when a page is not in its happy state, plus a
handful of layout and accessibility defects.

Every claim below was verified against the current tree, not against the audit
screenshots — those were captured at 00:27:27, before
`app/(shop)/products/[id]/page.tsx` (00:28:22) and `theme.css` (00:33:46) were
last modified, and several defects they show are already fixed.

Verified open defects:

- **An empty table draws its own column headers.** `CursorTable` passes the
  empty state through ANTD's `locale.emptyText`, which renders *inside* the
  table body — so `/orders` with no orders shows `ORDER STATUS ITEMS TOTAL
  PLACED` above a slab reading "Nothing here yet". Column headings for columns
  that do not exist.
- **Empty states say nothing and offer nothing.** `CursorTable`'s default is
  `<EmptyState title="Nothing here yet" />` — no description, no action, on a
  component whose own doc comment argues an empty state should name what is
  missing and offer the action that fixes it.
- **Loading is generic.** Every page renders `<Skeleton paragraph={{ rows: 6|8 }} />`
  — grey lines that match no layout on the page they stand in for.
- **A failed fetch leaves a blank page.** `notifyProblem` raises an ANTD
  notification and the page renders its empty state. The toast disappears after
  eight seconds and what is left says "Nothing here yet", which is a lie: the
  request failed. There is no retry anywhere.
- **The hero carries a decorative placeholder.** `mp-hero-shot` renders the
  newest product's generated monogram at hero scale. On a seeded tenant it reads
  as a broken image, not as art direction.
- **Card meta collides at 390px.** Price and availability share a flex row;
  `899.00 USD` and `11 in stock` wrap to two lines, leaving ragged grid rows and
  uneven cards.
- **The admin sidebar lists actions as destinations.** `New product` and
  `New event` sit in the Catalogue nav group alongside `Products` and `Events`,
  and each also has a primary button on the page it belongs to.
- **No `aria-current`.** Active navigation is expressed only as `data-active`,
  which styles a link and tells assistive technology nothing. Both shells.
- **No skip link.** Keyboard users traverse the whole nav on every page.
- **Motion is unguarded.** 247 tokens and one `prefers-reduced-motion` block.
- **`theme.css` is 1257 lines** holding tokens, reset, ANTD corrections,
  component rules and page layouts in a single cascade.

## Constraints

- **The engine has no `PATCH` or `DELETE`.** Admin is structurally read-only.
  No edit forms, no inline editing, no destructive actions.
- **Ant Design is the component library.** Custom CSS extends and corrects it.
  No second component library, no replacement.
- **Cursor pagination gives no total.** Pagination already works — `CursorTable`
  and the storefront grid both accumulate pages behind "Load more". No page
  numbers, no totals, and nothing here may invent them.
- **Attribute fields are tenant-defined.** Labels come from the registry at
  runtime, so no layout may assume a field name, count or type.
- **Both themes, always.** Every change ships in light and dark or not at all.

## Architecture

### Stylesheet layering

`theme.css` splits into `app/styles/`, imported in cascade order:

| File | Holds |
|---|---|
| `tokens.css` | The `--mp-*` custom properties, light and dark |
| `base.css` | Reset, typography, links, focus ring, tabular numerals |
| `antd.css` | Every rule that exists only to correct an ANTD default |
| `components.css` | Card, sidebar, header, filter rail, status tag, empty state, skeletons |
| `pages.css` | Detail, checkout and chat layouts |

`theme.css` becomes five `@import`s. Ordering is the cascade, stated once. A
rule that fights ANTD lives in the file named for that job, so "why does this
override exist" is answerable by location. The split is mechanical — rules move
verbatim, in order — so it changes no rendered pixel, and the audit screenshots
prove that.

### New components

- **`Skeleton`** — shape-matched placeholders in three variants: `grid` (card
  rectangles in the real grid), `table` (header plus striped rows), `detail`
  (media block beside a stack). Replaces every generic ANTD skeleton.
- **`ErrorPanel`** — takes a `ProblemError` and an `onRetry`. Renders inline, in
  place of the content that failed, showing `title`, `detail` and `traceId`.
  The toast stays; this is what remains on screen after it fades.
- **`Toasts`** — a thin wrapper standardising ANTD's `message`/`notification`
  use so success and failure feedback look the same everywhere.

`EmptyState` gains required `description` and `action` props — the type stops
allowing a bare title, so the `/orders` case cannot recur.

### Fetch state

The three-way `loading | error | data` branch is currently hand-rolled per page,
which is why it is inconsistent. It moves into one `useResource` hook returning
`{ data, error, loading, retry }`. `CursorTable` and every detail page consume
it, so a page cannot forget a state it never wrote.

## Page decisions

**`CursorTable`.** When a load returns no rows, the entire `<Table>` is replaced
by the empty state — headers included. When it fails, it is replaced by
`ErrorPanel`. The table renders only when it has rows to put in it.

**Empty states.** Each gets a sentence and a primary action: empty orders offers
"Browse products", empty bookings offers "Browse events", an empty admin
catalogue offers "New product".

**Storefront grid.** The filter rail becomes sticky under the header, so the
column stops dying at 770px against a 2000px grid. The results bar gains a sort
control — name, price ascending, price descending — expressed through the
existing search endpoint.

**Product card.** Price takes its own line at full weight; availability becomes
a caption beneath it. Cards become equal-height so rows stop laddering.

**Hero.** `mp-hero-shot` is deleted. The stat tiles stay.

**Admin sidebar.** `New product` and `New event` leave the nav groups.
Navigation lists places; the pages already carry the actions.

## Accessibility

- `aria-current="page"` on the active nav item in both shells.
- A skip link to `<main>`.
- The mobile drawer and filter sheet trap focus, close on `Escape`, and return
  focus to their trigger.
- `aria-live="polite"` on the results count, so filtering announces its result.
- Every muted-ink token checked for 4.5:1 against its background in both themes.
  Failing tokens get darkened; the palette may shift slightly and that is
  accepted.
- Visually-hidden captions on tables.

## Motion

Two duration tokens (`--mp-motion-fast: 120ms`, `--mp-motion-base: 200ms`) and
one easing token, applied to hover, theme switch, drawer and sheet, all inside
`prefers-reduced-motion` guards that flatten to none.

## Verification

Screenshots are the acceptance criterion. Passing tests prove behaviour; only
looking proves appearance.

`test/e2e/zz-audit.spec.ts` extends to three viewports (1440, 834, 390) across
both themes, plus the loading, empty and error variants — error by routing the
request to a failure, loading by delaying it. Every screenshot is reviewed by
eye before the work is called done.

`axe-core` runs against each page in the e2e suite and fails on serious and
critical violations.

Unit tests cover the new components and the hook: that `ErrorPanel` surfaces a
problem document's `detail` and `traceId`, that `CursorTable` renders no
`<table>` element when the result set is empty, and that `useResource` exposes a
`retry` that refetches.

## Out of scope

- Admin edit and delete UI — blocked on engine write routes.
- Payments, and checkout beyond the existing cart.
- Any new engine route.
- Replacing Ant Design.
