# Public storefront: a shop a stranger can visit

**Date:** 2026-09-03 · **Roadmap:** `docs/ROADMAP.md`, Theme A, first slice
**Status:** approved by the owner ("go ahead and implement rest"), ready for planning

## Purpose

Today every storefront route redirects to `/login`, and the tenant a page shows
is read from the signed-in user's JWT. A person with no account cannot see a
shop, and no hostname names one. This slice makes the storefront public: a
visitor opens `acme.localhost:3002`, browses products and events, reads the
About page, and is asked to sign in only when they try to buy.

Two things are deliberately left for the next slices: guest checkout (the cart
still belongs to a signed-in buyer) and server rendering with SEO metadata.
This slice puts the tenant-by-host seam and the public read surface in place;
those build on it.

## Decisions

- **Tenant comes from the hostname, never from a query string or a cookie.**
  `<tenantId>.<platform host>` maps to a tenant. The platform host is
  `NEXT_PUBLIC_PLATFORM_HOST`, default `localhost:3002`. Chromium resolves any
  `*.localhost` name to loopback without a hosts entry, so the local stack
  needs no DNS work.
- **A bare platform host keeps today's behaviour.** `localhost:3002` with no
  subdomain has no host tenant: the shop reads the tenant from the token and
  requires sign-in, exactly as now. Every existing journey, spec and campaign
  case runs unchanged.
- **The engine gets one public read surface, under `/shops/:tenantId`.** It
  is the second code path allowed to put a tenant id into a partition key
  (the first is the JWT claim; the SQS consumer re-validates the same way).
  It validates against the same exported `TENANT_ID_PATTERN` and answers 404
  for anything that fails it.
- **Public readers see only what a shopper may see.** Products with status
  `active` or `out_of_stock`; everything a tenant publishes; never a draft,
  never an archived product, never a storefront draft. The filter is applied
  in the DynamoDB query, so public pages are full pages, not pages with holes.
- **A signed-in session must match the host.** If a token's tenant is not
  the host's tenant, the shop signs that session out and treats the visitor
  as anonymous. A buyer of `globex` cannot carry their session into `acme`.
- **The cockpit is not part of this slice.** `/admin` under a shop host works
  as it does today for a matching admin token; moving it to its own host is
  Theme A's later work.

## Engine

### `shops` module — `apps/engine/src/shops/`

`ShopsController`, route prefix `shops/:tenantId`, every handler `@Public()`:

| Route | Delegates to | Public rule |
|---|---|---|
| `GET /shops/:t/storefront` | `StorefrontService.getPublished` | published config or `{ config: null }` |
| `GET /shops/:t/announcement` | `SettingsService.getAnnouncement` | as stored |
| `GET /shops/:t/schemas` | `SchemaRegistryService.get` per entity | same view as `GET /schemas` |
| `GET /shops/:t/products` | `ProductsService.listVisible` | status filter in the query |
| `POST /shops/:t/products/search` | `ProductsService.searchVisible` | caller's `status` ignored; visible statuses forced |
| `GET /shops/:t/products/:id` | `ProductsService.getVisible` | 404 unless visible |
| `GET /shops/:t/events` | `EventsService.list` | as stored (events carry no status) |
| `GET /shops/:t/events/:id` | `EventsService.get` | as stored |

`ShopScope` is a small provider with one method,
`run<T>(tenantId: string, fn: () => Promise<T>)`. It checks the id against
`TENANT_ID_PATTERN` (404 `not-found`, "No such shop", on failure — a 400 would
say the id is malformed, which is more than a stranger needs to know) and
runs `fn` inside `runWithTenant` with the public principal
`{ tenantId, userId: 'anonymous', role: 'public' }`. Every controller method
is one `ShopScope.run` call around an existing service call. The role
`'public'` matches no `@Roles()` list and no service-level admin check.

An unknown but well-formed tenant id answers an empty shop. There is no
tenant record to check against yet; Theme B's provisioning adds one and this
guard then answers 404 for a tenant that was never created.

### Products service

- `VISIBLE_TO_SHOPPERS = ['active', 'out_of_stock'] as const`, exported from
  the service so the web app's own copy of that rule can be deleted.
- `listVisible(limit, cursor)` — `queryPrefix` with filter
  `#status IN (:s0, :s1)`.
- `searchVisible(criteria)` — the search provider gains an optional
  `statuses` argument; `buildProductFilter` emits the `IN` clause and drops
  any `status` the criteria carried.
- `getVisible(id)` — `get`, then 404 unless the status is visible. The same
  problem document as a missing product: a draft's existence is not public.

### CORS

`CORS_ORIGINS` entries may carry a leading wildcard label:
`http://*.localhost:3002`. `originAllowed(origin, patterns)` in
`common/cors.ts` matches exact entries as before and wildcard entries by
scheme plus a one-label prefix on the host. `app.factory.ts` passes it as the
`origin` function. Compose adds `http://*.localhost:3002` to both services'
lists. The cors int-test gains a wildcard case and a negative case
(`http://evil.example:3002`, and `http://a.b.localhost:3002` with two labels).

### Tests

- Unit: `ShopScope` (pattern rejection, principal shape, context is bound
  inside `fn`); `buildProductFilter` with statuses; `originAllowed`.
- e2e `test/e2e/shops.e2e.test.ts`, its own tenant: no token → 200 on every
  public route; a draft product is listed to the admin and absent from the
  public list; public get of that draft is 404; public search ignores a
  `status: 'draft'` in the body; an archived product is not visible; another
  tenant's product id is 404 through this shop; a malformed tenant id is 404;
  `GET /shops/:t/storefront` is `{ config: null }` before publish and the
  published config after; the storefront draft has no public route.

## Web

### Host resolution — `lib/shop/shop-host.ts`

`shopFromHost(host, platformHost): string | null`. `host` is
`window.location.host` (with port). Returns the single label before
`.<platformHost>` when it matches `TENANT_ID_PATTERN`; `null` for the bare
platform host, for two or more labels, for a different platform, and for the
reserved labels `admin`, `www`, `api`. Pure and unit-tested.

### Shop context — `lib/shop/shop-context.tsx`

`ShopProvider` (client) computes `{ tenantId, public: true } | null` from the
host on mount and provides it; `useShop()` reads it. Mounted in the root
layout above `SchemaProvider`, because schemas must load for a public
visitor with no token.

### Reads — `lib/api/shop.ts` and `lib/shop/reads.ts`

`lib/api/shop.ts` holds the public wrappers (`publicListProducts(tenantId,
limit, cursor)` and the rest of the table above), each validated against the
same contract schemas the token wrappers use.

`useShopReads()` returns one object — `listProducts`, `searchProducts`,
`getProduct`, `listEvents`, `getEvent`, `getStorefront`, `getAnnouncement`,
`listSchemas` — bound to the public wrappers when `useShop()` is public and to
the existing token wrappers otherwise. Pages and components call the object;
none of them knows which side it is on.

### The shop shell — `(shop)/layout.tsx`

- Public shop: no login redirect for browse routes. `/cart`, `/orders`,
  `/bookings` remain protected and redirect to `/login?next=<path>`.
- Public shop with a signed-in principal whose `tenantId` differs from the
  host's: call `signOut()` and continue anonymously.
- Bare platform host: unchanged.
- The storefront config is fetched through `useShopReads().getStorefront`.

### Header, hero, pages

- `ShopHeader` anonymous state: Products, Events, About as now; no Orders,
  Bookings, role chip or Sign out; a **Sign in** button linking to
  `/login?next=<pathname>`. Signed in: unchanged, so `auth.spec.ts` still
  finds `Products` and `Orders` by name.
- `StorefrontHero` takes the tenant from `useShop()?.tenantId ??
  principal?.tenantId`.
- `AnnouncementBar`, `MoreFromShop`, products list, product detail, events
  list, event detail read through `useShopReads()`.
- Product detail, anonymous: **Add to cart** routes to
  `/login?next=/products/<id>` instead of calling the cart.
- Event detail, anonymous: the booking form is replaced by a Sign in to book
  button with the same `next`.
- Login page honours `next` (same-origin path only; anything else falls back
  to `/products`).
- `SchemaProvider` fetches public schemas when the shop is public, token
  schemas otherwise.

### Tests

- vitest: `shopFromHost` cases; `useShopReads` picks the right side; shop
  layout signs out a mismatched session and does not redirect a stranger on
  `/products` but does on `/cart`; header anonymous state; product detail
  routes to login when anonymous; login `next` handling.
- Journeys, new section **"A stranger at the door"** against
  `http://<tenant>.localhost:3002` in a fresh browser context with no session:
  the active product is on the page and the draft is not; product detail
  opens and Add to cart lands on login with `next` set; events list renders;
  the other tenant's host shows none of this tenant's products; a signed-in
  buyer of tenant B visiting tenant A's host is signed out; the API answers
  the public routes with no token and 404s the draft.
- Screenshots: the public shop at a published preset, light and dark, looked
  at before the slice is called done.

## Error handling

- Malformed or unknown tenant on the engine: 404 problem `not-found`.
- Public fetch failures in the web app: the same panels the pages show today.
- No new `ProblemType`.

## Out of scope

Guest cart and checkout; server rendering, metadata, sitemap; customer
identity separate from staff; cockpit on its own host; custom domains.
