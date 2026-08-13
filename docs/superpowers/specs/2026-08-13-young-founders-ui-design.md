# Young Founders UI — Design

**Date:** 2026-08-13
**Status:** Approved direction, pending spec review
**Predecessors:** `2026-08-08-professional-ui-design.md`, `2026-08-08-ui-craft-pass-design.md`

## Intent

Make the platform somewhere a young first-time founder wants to build a business —
and somewhere their customers trust enough to pay. Those pull in opposite
directions, so the design splits them: the seller's back office is bold, warm and
celebratory; the storefront their buyers see stays calm and credible. Light mode
becomes the primary theme in both shells.

Decided with the user in the visual companion session of 2026-08-13
(mockups in `.superpowers/brainstorm/11529-1786618127/content/`, not committed):

- Audience: anyone starting their first business; tone matters more than age.
- Tone: bold and expressive — but scoped to the seller cockpit only ("split").
- Banner feature: announcement bar (seller-controlled strip on the storefront).
- Cockpit palette: deep blue ink and spring-green accents on cool white, light first.
- Storefront: keeps its teal identity, restyled light-first.

## 1. Theme system: light first, two volumes

Light becomes the default theme for new visitors in both shells. The dark theme
remains available on the existing toggle and is restyled to match the new
palettes. The `data-theme` mechanism, tokens-in-CSS approach and the four-file
stylesheet layering (`base` / `antd` / `components` / `pages`) stay.

**Storefront (buyer-facing, `(shop)` + login).** Calm and credible. Teal stays
the accent. Light theme is designed first-class rather than derived:

- The hero band loses its hard-coded dark gradient (`components.css:294`) and
  gets a light treatment built from tokens, so it belongs on a white page.
  The dark theme keeps a dark hero, expressed through the same tokens.
- The remaining ANTD default-blue leaks (Select option hover/active fill — seen
  on the login persona picker — plus any others a sweep finds) are closed by
  finishing the token map in `antd.css`.

**Cockpit (seller-facing, `(admin)`).** Bold, warm, celebratory:

- Ground: cool white (`#f8fafc`-class). Sidebar: light (`#eef4fb`-class) with
  blue-ink text — replacing the permanent dark sidebar.
- Ink: deep blue (`#0c4a6e`-class) for headings.
- Accent: spring-green to sky gradient (`#10b981` → `#0ea5e9`) for primary
  buttons, active nav, progress marks and celebration moments.
- Contrast rule: gradients decorate; text always sits on AA-checked solid
  tokens (`#047857`-class green for text-level accents, never raw `#10b981`
  on white).
- Dark cockpit variant: current dark bones with the new accent tokens.

Both shells keep WCAG AA as a hard gate in both themes (axe suite already
enforces serious/critical).

## 2. Craft corrections (both shells)

Defects found by eye in the 2026-08-13 capture review:

- **Numeric columns align right**: `PRICE`, `STOCK`, `CAPACITY`, `BOOKED`
  across admin products, storefront events, and any other numeric column.
  Tabular figures are already applied; alignment is not.
- **Events table**: `CAPACITY` and `BOOKED` merge into one column, "Booked",
  rendering "2 of 50" — one fact, one column.
- **Monogram placeholder tiles**: washes derived from the shell's palette
  (seeded per product id, as now, but constrained to palette hues instead of
  arbitrary maroon/olive). Two-letter mark at a size that holds the tile.
  Card media ratio changes 5:4 → 4:3 so the tile stops dominating the card.
- **Cart lines** get product thumbnails (image or monogram tile).
- **Role chip** (`admin`/`buyer` in the storefront header) gets a deliberate
  style instead of default-tag look.
- **Mobile storefront chrome** tightens from ~170px of header to two rows:
  brand + actions on one row, nav strip on the second.
- **Admin new-product form**: `Price (minor units)` becomes the same
  money-in-major-units input the storefront cart uses (shared control).
- **Copy**: "Images can only be attached now — the engine has no update
  routes." dies. Replacement explains the constraint in user terms ("Add
  photos when you create the product — they can't be changed afterwards yet.").

## 3. Pages hold their weight

- **Product detail**: the dead lower half gains a specifications panel
  (existing specs data, presented properly) and a "More from this shop" row of
  product cards (same tenant, excluding the current product; no engine change —
  existing list endpoint).
- **Event detail**: same treatment with event facts and "More from this shop".
- **Short lists and empty states**: max-width containers sized to content so a
  one-row table or an empty state doesn't float in a full-width void.

## 4. Founder onboarding

The admin Products empty state becomes the "first screen that knows it's a
first screen":

- Headline "Your shop is ready" (cockpit tone), three steps:
  1. **Shop created** — always checked, names the shop.
  2. **List your first product** — checks off when product count > 0.
  3. **Share your shop link** — copy-link button for the storefront URL;
     presented as an action, not a checkable state.
- Steps derive from data already on the client (product list length); no new
  endpoints.
- Once the shop has products, the Products page is the normal table — the
  checklist only exists while it earns its place.
- **Jargon pass**: "tenant" and "catalogue" never face a user. "Everything in
  this tenant's catalogue" → "Everything in your shop", and a sweep of both
  shells for the same vocabulary.

## 5. Announcement bar

The seller controls one line of text on their storefront:

- **Engine** (the only cross-stack piece): a `settings` module following the
  existing NestJS module pattern (`products/`, `events/`, …), storing a single
  tenant-settings record via the existing Dynamo repository
  (`TENANT#<id>` partition, `SETTINGS` sort key).
  - `GET /api/v1/settings/announcement` — public within tenant context,
    returns `{ text, enabled }`.
  - `PUT /api/v1/settings/announcement` — admin role, validates text
    (single line, length-capped ~140 chars).
- **Cockpit**: a small "Announcement" card (Settings-adjacent placement decided
  in plan) with text field and on/off switch.
- **Storefront**: when enabled and non-empty, a slim teal strip above the
  header. No dismiss state in v1 (it is the shop's own banner, not a cookie
  notice).

## 6. Verification

- TDD throughout (unit first for formatters/components, spec-level e2e for
  flows).
- New e2e coverage: announcement bar set → shown; onboarding checklist states;
  admin money input.
- The audit capture suite is re-baselined: light captures become the primary
  set, dark secondary; every changed surface re-reviewed by eye before close
  (per `verify-ui-with-screenshots` practice).
- axe AA suite passes in both themes, both shells.
- Full local Docker e2e green before the branch closes (per
  `docker-first-e2e-testing`).

## Out of scope (recorded, not dropped)

- Featured shelf (banners option C) — needs a featured flag; follow-up.
- Shop banner artwork/avatar (banners option A) — follow-up; pairs with the
  upload pipeline that already exists for products.
- Chat page restyle — deferred since the 08-08 spec; unchanged.
- Events date-based ordering — engine index work, tracked from the 08-08 plan.
- Zero-decimal currencies in `formatMoney`/`toMinor` — pre-existing, unchanged.

## Open questions resolved during brainstorm

- Bold-everywhere vs split → **split** (bold cockpit, calm storefront).
- Palette → **deep blue & spring green on cool white**, light first (violet
  option declined after seeing both).
- Banner meaning → **announcement bar**, not hero artwork, not featured shelf.
