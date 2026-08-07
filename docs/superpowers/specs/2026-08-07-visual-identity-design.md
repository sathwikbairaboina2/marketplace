# Visual identity for MarketplaceWeb

**Date:** 2026-08-07
**Status:** approved, not yet implemented

## Purpose

Give the console a designed appearance instead of ANTD's defaults.

The console works and is verified end to end, but it looks like what it is: an
unstyled component library. Default blue, dense tables, no considered spacing or
type, no empty or loading states, no responsive behaviour, and — now that
products carry real photography — nowhere that photography is actually shown to
advantage.

This deliberately reverses a line in the console's own spec, which put *"theming,
branding and responsive design beyond what ANTD gives by default"* out of scope.
That was the right call for a first delivery and is the wrong call now.

The reference is Shopify: Polaris-informed for the back-office, Dawn-informed
for the storefront. Informed, not copied — no Shopify brand asset, logo, or
their green.

## Current state

- `apps/web` is a Next.js App Router application on `:3002`. Every data page is
  a client component; there is no server-side data fetching.
- `components/app-shell.tsx` renders one chrome for everything, branching on
  `pathname` only to bypass itself on `/login`. Navigation is a single
  horizontal `Menu` of up to nine items, with tenant and role as small tags.
- Routes are flat: `app/products`, `app/events`, `app/cart`, `app/orders`,
  `app/bookings`, `app/admin/*`, `app/login`.
- `ProductRecord.images` now holds real URLs, uploaded through the engine and
  served public-read from the `marketplace-media` bucket. Nothing renders them
  larger than a 160px thumbnail.
- Forms, filters and detail rows for tenant-defined `attributes` are generated
  from `GET /schemas` by `lib/schema-fields/`. Filters are scalar-equality only,
  because that is all `SearchProductsSchema` supports.
- `CursorTable` accumulates cursor-paginated pages behind a "Load more" button.
  It has a loading prop and no empty state.
- Status values are rendered as bare text or ad-hoc `Tag` colours: flows are
  `proposed` / `applied` / `rejected`, orders `pending` / `confirmed` /
  `cancelled`, bookings `confirmed` / `cancelled`.
- Twelve Playwright specs pass. Several select by accessible role and label
  (`getByLabel('Name')`, `getByRole('button', { name: 'Create' })`), so they
  constrain what the redesign may change about semantics.
- 68 Vitest tests pass.

## Approach

### The theme layer

One source of truth. `lib/theme/tokens.ts` exports the palette, spacing scale
and type scale as plain objects. Two consumers derive from it:

- an ANTD theme passed to `ConfigProvider`, built with `theme.defaultAlgorithm`
  or `theme.darkAlgorithm`;
- a set of CSS custom properties for the surfaces ANTD does not own — the
  sidebar, the hero, the filter rail, the product card.

Deriving both from one object is the point. A palette split across an ANTD
config and a stylesheet drifts the first time someone adjusts one of them, and
the result is a `Button` that no longer matches the panel it sits on.

**Palette — slate and teal.** Primary `#0d9488`, deep `#115e59`, ink `#0f172a`,
muted `#475569`, line `#e2e8f0`, surface `#f8fafc`. Shopify-informed without
wearing Shopify's green, which on a product that is not theirs would read as
borrowed rather than referenced.

**Type.** Inter throughout, via `next/font/google`, which downloads at build time
and self-hosts. Nothing fetches from a CDN at runtime — the container is the only
place this ever runs, and a webfont request that fails there fails silently into
a fallback nobody chose.

**Dark mode.** Preference in `localStorage`, defaulting to
`prefers-color-scheme`. A small inline script in the root layout stamps
`data-theme` on `<html>` **before first paint**. Without that the page renders
light and then corrects itself on hydration, which is the most conspicuous
defect a dark mode can have and the hardest to un-see.

### Two shells, via route groups

`AppShell` branches on `pathname` today. That does not survive two genuinely
different chromes, so routes move into Next.js route groups:

```
app/(shop)/products, events, cart, orders, bookings   -> ShopShell
app/(admin)/admin/*                                    -> AdminShell
app/login                                              -> bare centred layout
```

Each group owns a `layout.tsx`. `AuthProvider`, `SchemaProvider` and
`CartProvider` stay in the root layout, so state is shared across both shells and
a buyer who is also an admin does not lose their cart by navigating.

**A route can render in only one shell.** Admins currently browse `/products`,
which becomes the storefront grid. So the admin side gains its own dense list
pages, `/admin/products` and `/admin/events` — which is what Shopify does, and
what the grouped navigation already implies. These are two pages this work would
not otherwise have created, and they are a consequence of the two-mode decision
rather than an independent feature.

### Admin shell

Dark sidebar, no top bar. Navigation grouped:

| Group | Items |
|---|---|
| Catalogue | Products, Events, New product, New event |
| Sales | Orders, Bookings |
| Schema | Flows, Chat |

Identity sits in the sidebar foot: tenant, role, sign out. **The tenant gets real
visual weight** — a coloured block, not small grey text. Moving it out of a top
bar cost it prominence, and switching between `acme` and `globex` is how tenant
isolation is demonstrated; it has to be somewhere the eye lands.

Pages are card-based: a `PageHeader` with title and primary action, then content
in bordered surfaces rather than floating on the background.

### Storefront

Light chrome. A top bar carrying the tenant name, Shop / Events / Orders /
Bookings, and a cart control showing its line count.

**Hero**, filled from live data: tenant name, product count, category count, and
the newest product with its thumbnail. No invented marketing copy — it stays
true for any tenant, including one seeded five minutes ago, and needs nobody to
write for it.

**Filter rail**, persistent on the left, generated from the registry. Persistent
rather than behind a drawer for a reason specific to this platform: when an agent
proposes a field and someone executes the flow, the new filter should appear in
front of the user. Hidden behind a control, the one thing the system exists to
demonstrate becomes something you have to go looking for. A registry field first
seen within the last few minutes carries a brief highlight, so it announces
itself.

This is affordable only because dynamic-attribute search is scalar equality,
which keeps the rail narrow. If ranges are ever added, the rail must be
revisited.

**Product grid**, three across, using the uploaded photography. Where a product
has no image, a deterministic placeholder — a gradient seeded from the product
id, with the name's initials — so the grid never renders as broken boxes and the
same product always looks the same.

### Responsive

| Breakpoint | Behaviour |
|---|---|
| `< md` | Grid one column; filter rail becomes a bottom sheet |
| `md–lg` | Grid two columns; sidebar becomes a drawer |
| `>= lg` | Full layout as designed |

Admin tables scroll horizontally (`scroll={{ x }}`) rather than reflowing. A
cursor-paginated table has no honest narrow layout — there is no page count to
summarise and no row that is safely droppable — and stacking cells produces
something harder to read than a scroll.

### Components

New: `ThemeToggle`, `PageHeader`, `EmptyState`, `StatusTag`, `ProductCard`,
`ProductGrid`, `StorefrontHero`, `FilterRail`, `AdminSidebar`, `ShopHeader`.

`StatusTag` maps every domain status to a semantic colour **and a text label**.
Colour is never the only carrier: `proposed` and `applied` differ in meaning in a
way a colour-blind viewer must still be able to read, and these particular states
gate whether someone irreversibly mutates a tenant's data model.

`CursorTable` gains skeleton rows while loading and an `EmptyState` when a
tenant has nothing — which is the first thing a new tenant sees, and currently
an unexplained empty rectangle.

### What does not change

No API calls, no contracts, no engine behaviour. Every page keeps the data it
fetches and the order it fetches it in. This is presentation only, and any
change to a request is out of scope and a signal something has gone wrong.

## Testing

**Unit** — token derivation for both algorithms; theme resolution from stored
preference and from OS setting when unset; `StatusTag`'s mapping for all eight
status values; placeholder determinism (same product id, same gradient).

**End to end** — the existing twelve specs must pass **unchanged**. They select
by accessible role and label, so they are the regression net for the redesign:
if a form label or button name moves, they catch it. Two new specs: a chosen
theme survives a reload, and the admin sidebar collapses to a drawer at mobile
width.

That the existing suite passes untouched is the bar for "the redesign did not
break the application". Editing a spec to accommodate the redesign is only
acceptable where the change is deliberate and noted.

## Out of scope

- Any change to API requests, contracts, or engine behaviour.
- Animation and transitions beyond ANTD's defaults.
- A logo or wordmark. The tenant name is the brand here.
- Print styles, internationalisation, right-to-left layout.
- Storefront features that do not exist yet: wishlists, reviews, related
  products, category landing pages.
- Image resizing or art direction. Uploaded photography is displayed as stored.
