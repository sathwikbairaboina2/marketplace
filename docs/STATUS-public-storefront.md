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

Run on 2026-09-03 against the live Docker stack, after the stack moved to the
+30000 host-port block and onto the shared `research-ollama` daemon (see
`docs/STATUS.md`, same date):

| Suite | Result |
|---|---|
| Devkit boot (`_devkit/marketplace/devup.ps1 -Reset`) | UP: health, docs, auth, tenant isolation, spoofed-header check all pass |
| Engine e2e (`test:e2e`, incl. `shops.e2e.test.ts`) | 18 suites, 147 tests green |
| Engine unit + int-tests (`turbo run test`, incl. `cors.int-test` wildcard cases) | 40 suites, 261 tests green |
| Agents unit + int-tests (incl. the live-model `ollama.provider.int-test`) | 31 suites, 153 tests green |
| Web unit (`vitest run`) | 48 files, 273 tests green |
| Web build (`next build`, lint + types) | clean, inside the web image build |
| Browser journeys (`e2e:journeys`) | 91 of 91, incl. the seven "a stranger at the door" journeys |
| Playwright specs (`test:e2e`) | 31 passed |
| Screenshots | `acme.localhost:33002` `/products`, `/events`, `/about` in a fresh context: Sign in offered, no Orders/Bookings, seeded images load from the media port, About shows its honest empty state |

One journey failed on the first run and it was not this slice: "the support
agent answers from the buyer's own orders". The order facts handed to the
model carried a date with no time, so on a same-day order book the stronger
`qwen3.8:27b` correctly said it could not tell which order was the most
recent, where `qwen2.5:7b-instruct` used to guess. The facts now carry the
time of day and are listed newest first, and say so; a unit test pins it.

The storefront's dark theme is a header toggle, not `prefers-color-scheme`,
so a dark-scheme browser context renders the same as light. Nothing in this
slice changed that.

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
