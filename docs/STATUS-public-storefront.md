# Public storefront — status

**Date:** 2026-09-03 · **Branch:** `feat/public-storefront` (stacked on
`fix/onboarding-setup-plan-gaps`)
**Spec:** `docs/superpowers/specs/2026-09-03-public-storefront-design.md`
**Plan:** `docs/superpowers/plans/2026-09-03-public-storefront.md`
**Roadmap:** `docs/ROADMAP.md`, Theme A, first slice

## What shipped

A shop a stranger can visit. `<tenant>.localhost:3002` names a shop; a visitor
with no session browses its products, events and About page and is asked to
sign in only when they try to buy or book. The bare `localhost:3002` keeps
every behaviour it had.

- **Engine** — `shops` module: `GET /shops/:tenantId/{storefront,
  announcement, schemas, products, products/:id, events, events/:id}` and
  `POST /shops/:tenantId/products/search`, every route `@Public()`.
  `ShopScope` validates the id against the shared `TENANT_ID_PATTERN` (404
  `not-found` on failure, never a 400 that admits the id is malformed) and
  runs the existing services under a `{ role: 'public', userId:
  'anonymous' }` principal, which no `@Roles()` list and no service admin
  check accepts. Products gain `listVisible`, `searchVisible` and
  `getVisible`: the status filter `#status IN (active, out_of_stock)` runs in
  the DynamoDB query, so public pages are full pages; a caller's own
  `status` in a public search is dropped. CORS accepts
  `http://*.localhost:3002` through `originAllowed`, one label only.
- **Web** — `shopFromHost` reads the tenant from `window.location.host`
  against `NEXT_PUBLIC_PLATFORM_HOST` (default `localhost:3002`; `admin`,
  `www` and `api` reserved). `ShopProvider` sits above `SchemaProvider` so a
  stranger's filter rail still knows the tenant's fields. `useShopReads()`
  is one object bound to the public wrappers on a shop host and to the token
  wrappers on the platform host; the storefront pages, the announcement bar
  and More from this shop read through it. The shop shell no longer redirects
  browse routes to login on a shop host, still protects `/cart`, `/orders`
  and `/bookings` (with `next=` back to the page), and signs out a session
  whose tenant is not the host's. The header offers **Sign in** to a
  stranger and hides Orders, Bookings and Sign out. Add to cart and Book send
  a stranger to login with `next` set; the login page honours a same-origin
  `next`.

## Verification

Run on 2026-09-03:

| Suite | Result |
|---|---|
| Engine unit (`jest --testPathIgnorePatterns int-test`) | all suites green, incl. new `cors`, `shop-scope`, `products.service.visible`, extended `dynamo-search.provider` |
| Engine typecheck (`tsc --noEmit`) | clean |
| Web unit (`vitest run`) | 48 files, 273 tests green, incl. new `shop-host`, `reads`, `(shop)/layout`, extended `shop-header` |
| Web build (`next build`, lint + types) | clean |
| Journeys harness | `node --check` clean; 91 journeys defined (was 83) |

**Not run, and why.** The engine e2e suite (`shops.e2e.test.ts`, 11 cases),
the CORS int-test's two wildcard cases, the 91 browser journeys and the
preset screenshots all need the Docker stack. At the time of writing ports
3000 and 6379 were held by other projects' containers (`instascraper-web-1`,
`lipsync-redis`) and 3001 by a stale `remotion still --help` node process, and
the session's permission mode refused to stop them. The devkit's own
preflight (`_devkit/marketplace/devup.ps1`) would refuse for the same reason.
Until those run, this slice is **built and unit-verified, not proven end to
end**; the CLAUDE.md rule that a UI change is finished only when it has been
rendered and looked at has not been met.

To finish the verification once the ports are free:

```
docker stop instascraper-web-1 lipsync-redis      # or move them off 3000/6379
pnpm docker:up
pnpm --filter @marketplace/engine test:e2e
pnpm --filter @marketplace/web e2e:journeys
pnpm --filter @marketplace/web test:e2e
```

then open `http://<published tenant>.localhost:3002/products` and `/about`
in a fresh browser context, light and dark, and look.

## Decisions worth remembering

- **Tenant by host, never by query string or cookie.** One label in front
  of the platform host. Chromium resolves `*.localhost` to loopback on its
  own, so the local stack needs no DNS entry.
- **The public principal is a role, not a flag.** `role: 'public'` reuses
  every existing check unchanged: an admin-only service method refuses it
  the way it refuses a buyer.
- **Visibility is the engine's rule.** The web app's own
  `SHOPPER_VISIBLE` filter survives only for the token route, which serves
  the cockpit too and returns every status.
- **A foreign session is signed out, not tolerated.** A `globex` buyer on
  `acme.localhost` becomes a stranger; the token routes would otherwise
  answer for the wrong tenant on the same page.
- **An unknown but well-formed tenant is an empty shop.** There is no
  tenant record to check against until Theme B's provisioning writes one;
  the guard then answers 404 for a shop that was never created.
- **The token-side `readsFor` wraps every function** rather than passing
  it through, so a unit test that mocks one wrapper of `lib/api/products`
  is not forced to mock the rest.

## Next slice (Theme A, continued)

Guest cart and checkout on an anonymous signed cookie; server rendering of
the shop shell with `generateMetadata`, per-tenant sitemap and robots;
customers as an identity separate from staff; the cockpit on its own host.
