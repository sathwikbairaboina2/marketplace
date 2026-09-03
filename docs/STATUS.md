# Status

## 3 September 2026 — off the default ports, onto one shared model

Two changes so the stack coexists with everything else on this machine.
**Host ports are the defaults plus 30000**: engine `33000`, agents `33001`,
web `33002`, localstack `34566`, redis `36379`, dynamodb `38000`,
cognito-local `39229`. Inside the compose network nothing moved. Every
host-facing literal followed: the web image's `NEXT_PUBLIC_*`, the seed's
media URLs, `CORS_ORIGINS`, `S3_PUBLIC_ENDPOINT`, the harnesses and the
int-test defaults. One trap surfaced: cognito-local stamps `iss` from its own
default domain, `http://localhost:9229`, whatever port it is published on, so
the seed now writes `JWT_ISSUER` from `COGNITO_ISSUER_ORIGIN` and the harness
endpoint from `COGNITO_HOST_ORIGIN` separately.

**The stack no longer runs an ollama.** `agents` talks to the research-plugin
stack's `research-ollama` on `127.0.0.1:25103` (GPU attached, and the model
store is a volume that stack already shares with instacreator), which holds
`qwen3.8:27b`; `ollama-init` is a gate that runs `ollama pull` there and
fails fast if the daemon is down. The devkit boot checks the daemon before
building anything. Warm structured-output latency with thinking on is about
2.4s; the first call after the daemon loads the 17GB model is about 45s.

With the ports free the public storefront was finally proven end to end:
devkit boot UP, engine e2e 147/147, engine and agents unit+int 261 and 153
green, 91/91 journeys, 31 playwright specs, shop-host screenshots looked at.
Details in `docs/STATUS-public-storefront.md`. The model upgrade exposed one
real defect in the support agent (order facts had no time of day), fixed.

**Then a walk through the real browser found two more** that 91 green
journeys had not: the support box on a shop host said "Failed to fetch",
because the agents matched CORS_ORIGINS as a static list while the engine had
learned the `*.localhost` wildcard (the matcher now lives in
`@marketplace/auth` and both use it; a 92nd journey asks from the shop host);
and the seller's order page linked line items to `/admin/products/:id`, a
route that does not exist (now `/edit`, pinned by a test). Then fixed as well: the cockpit has a seller bookings page over a new
admin-gated `GET /bookings/all` (an admin may also open any booking in their
shop, as with orders), and seller order lines resolve the product name. The
storefront's light-first theme is a decision the theme context pins with a
test, not a defect, and stays.

One trap for the record: running an engine e2e suite while the journeys run
against the same stack turned 13 journeys red with session-loss symptoms;
the same journeys passed 93/93 alone a minute later. The CLAUDE.md rule about
parallel runs applies across harnesses, not just within one.

## 3 September 2026 — roadmap, and a shop a stranger can visit

`docs/ROADMAP.md` sets the direction: compete with Shopify on the
product-and-service long tail, eight themes A–H, six phases, agents staying
on local Ollama (`qwen3.8:27b`). Theme A's first slice landed on
`feat/public-storefront`: `<tenant>.localhost:3002` names a shop, a public
`/shops/:tenantId` read surface serves what a shopper may see with the status
filter in the query, and the storefront opens to strangers and asks for a
session only to buy. Engine unit and web unit + build green; **the e2e
suites, journeys (91) and screenshots have not run** because other projects'
containers held the stack's ports. Full account and the exact commands to
finish verification: `docs/STATUS-public-storefront.md`.

## 21 August 2026 — hygiene: run-scoped browser tenants, media isolation

Three backlog closers. **#19**: the playwright specs minted their litter into
the seeded demo shop; a `globalSetup` now mints two run-scoped tenants
(onboarding pre-dismissed) and `helpers/session.ts` remaps the old persona
names — spec files unchanged, demo shop untouched (one spec deliberately
keeps the real demo login to assert the token's tenant reaches the chrome).
**#05**: object keys were tenant-prefixed at upload but nothing checked the
other direction — a product or banner could carry any image URL. A stored
image must now point into the calling tenant's own bucket slice (enforced on
product create/update/batch and storefront drafts; pass-through when S3 is
unconfigured). **#09**: closed as a documented decision — the pino request
logs already carry ids and timings; metrics/tracing land with the deploy
path (#08), not before. Engine 231 unit, playwright 29 in run-scoped
tenants.

## 21 August 2026 — agent depth: copywriter and order support

Two one-shot agent tools over the existing LLM provider. `POST
/copywriter/draft` (agents service, admin service-checked): name + category
(+ tone/audience) in, 2-4 sentences out, capped at the product contract's
5000; a "Draft with AI" button fills the product form's editable description
field — nothing is stored until the seller saves. `POST /support/ask`: a
buyer's question answered from *their own* orders — the engine client
forwards the caller's token verbatim, so the engine's per-user scoping is
the isolation; an empty order book is answered directly without a model
call. The agents service HTTP routes gained CORS (both loopback spellings,
same discipline as the engine); a support box sits on the buyer's orders
page. Agents 116 unit across 29 suites; journeys 83/83 including both new
paths against the real local model.

## 21 August 2026 — seller dashboard, low stock, batch listing

`GET /stats/sales` (admin, service-checked): order counts by status, revenue
per currency (confirmed orders only — nothing sums across currencies), top
five products by units, active products at or under the low-stock threshold.
Aggregated on read under a ten-page scan budget; `truncated: true` marks the
numbers as a floor. Cockpit gains a Dashboard page (Sales group). `POST
/products/batch` (#18) creates up to 25 products in one call —
validate-everything-then-write-everything, a bad row rejects the batch whole.
Also fixed: the server-side cart persists across browser-suite runs for
shared users, so cart-counting specs now start by clearing it. Engine 226
unit / stats e2e 5, web 232 unit, playwright 29.

## 20 August 2026 — findability: free-text search and event ordering

Free-text product search (#11): a lowercased `search` blob written at product
create/update, matched with a `contains` filter under the existing ten-page
budget — case-insensitive because both sides normalise at their own edge;
products written before the field simply don't match until re-saved (seeds
recreate every boot). A Search box leads the storefront filter rail. Event
listings (#16) now sort soonest-first within the page — a shop's event count
is modest, so no date GSI. Engine 219 unit / e2e extended (text hit+miss,
sort order), playwright 29 green.

## 20 August 2026 — server-side cart and checkout with simulated payment

The buyer loop closed on `feat/cart-checkout`: a per-buyer cart in the engine,
`POST /checkout` into an `awaiting_payment` gate ahead of the owner's stages,
and a deterministic fake card provider behind a `PAYMENT_PROVIDER` interface
(Stripe magic numbers, declines render inline, cancel-from-gate restores
stock). Two defects found on the way — a non-nullable record type and DELETE
missing from the CORS preflight (the trap's third victim). Full account and
suite counts: `docs/STATUS-cart-checkout.md`. Suites after: engine 214 unit /
128 e2e, web 228 unit, playwright 29, journeys 81, campaign 164.

## 20 August 2026 — owner onboarding and storefront theming

Agent-driven owner onboarding shipped on `feat/owner-onboarding`: five preset
themes with bounded tuning, generated About page and banners, live-preview
wizard with explicit publish, optional ComfyUI banner art behind
`IMAGE_GEN_URL`. Full account, verification evidence and the three defects the
tests caught: `docs/STATUS-onboarding.md`. Suite sizes after: engine e2e 114
across 14 suites, browser journeys 78, web unit 219, contracts 146.

---

# Status — 17 August 2026

Where the project stands at the end of a session spent testing it hard and
fixing what the tests found. Written to be picked up cold tomorrow.

## What is true right now

| | |
|---|---|
| Branch | `master`, tree clean, **nothing pushed** (no remote configured) |
| Commits this session | 23, from `4388816` to `22804ba` |
| Unit and integration | 385 across 10 packages — contracts 105, engine 161, agents 80, web 160 files/27, openapi 23, auth 8, seed 8 |
| Engine end-to-end | 77 across 11 suites |
| Browser journeys | 65, whole-system paths (`pnpm --filter @marketplace/web e2e:journeys`) |
| Browser campaign | 161, one ordered session (`pnpm --filter @marketplace/web ui:campaign`) |
| Typechecks | clean on contracts, engine, agents, web |
| CI | `.github/workflows/ci.yml` exists; **never run on a runner**, because there is no remote |

Run everything with `npx turbo run test --concurrency=1`. The default fan-out
is unreliable on this machine — see "Traps" below.

## Bugs found and fixed

Ten defects, every one caught by a test rather than by reading code.

1. **Drafts were on the public storefront.** `GET /products` returns every
   status because the same route serves the cockpit; the shop window rendered
   it verbatim. `e5b9283`
2. **Role was read but never enforced.** A buyer's token — and one with no role
   at all — could create products, create events, and execute a schema flow.
   `51c69a9`
3. **Filtered search missed matches past the first page.** DynamoDB applies
   `Limit` to rows read and the filter after, so a price filter answered "no
   products" from a catalogue that had them. `a51b3de`
4. **Every request logged the caller's bearer token in full.** `9fc9a84`
5. **`PATCH` was not in the CORS preflight**, so the edit form sent a correct
   body to a correct URL and nothing arrived — the same trap that once
   swallowed `PUT`. `5fbf511`
6. **A tenant field could shadow a core one**, giving the seller's form two
   inputs both labelled "Name", permanently. `6011a06`
7. **A malformed cursor was an unhandled 500.** `51dc391`
8. **A whitespace-only name was accepted**, producing a card with no title.
   `a44a4ae`
9. **A slow settings fetch overwrote what the seller was typing**, publishing
   empty announcements with the toggle left on. `4388816`
10. **A yen rendered as a hundredth of itself** — ¥3,400 shown as 34.00.
    `ea3c161`

## Features added

- **Products can be edited** — `PATCH /products/:id`, admin-only, and an edit
  form in the cockpit that sends only what changed. Withdrawal is
  `status: 'archived'`; there is deliberately no hard delete (see Decisions).
  `c5d6819`, `ce76699`
- **Rate limiting and security headers** on both services. `22804ba`
- **Order and booking rows name what they refer to** instead of showing a
  reference alone. `f45eb09`
- **CI**, two jobs: unit/typecheck, and engine e2e without the model pull.
  `e8032fd`

## Decisions taken, and why

- **No hard delete.** Orders reference products; what an order should show when
  its product is gone is a product decision, not a mechanical one. Archiving
  covers withdrawal today.
- **The rate limiter runs before authentication.** A limiter that only sees
  authenticated requests stops neither a flood nor a password list.
- **No Content-Security-Policy yet.** The engine's only HTML is Swagger UI,
  whose inline bundle helmet's default policy breaks; the console renders
  antd's inline styles and a pre-paint theme bootstrap. A policy permitting
  `unsafe-inline` would claim a protection it does not provide. Doing it
  properly means threading a nonce through both.
- **Filtered reads have a ten-page budget.** Enough to find matches that are
  merely unlucky; a hard stop before a filter matching nothing walks a whole
  partition per request.

## Traps this machine will spring again

- **`localhost` resolves to `::1` first**, and Docker Desktop's IPv6 loopback
  proxy stops answering for minutes at a time, typically just after a container
  is recreated. curl falls back to IPv4; **Chromium does not** — measured at
  90ms to load the console on `127.0.0.1` against a 15s timeout on `localhost`,
  same second, same container. The client bundle and the API-side test
  harnesses now use the IPv4 literal; browser base URLs stay on `localhost`
  because the page's origin must match what the engine allows, and the engine
  now allows both spellings.
- **Parallel test runs lie.** Whole-repo `pnpm test` produced a dozen unrelated
  red suites twice, every one passing alone. `int-test` suites boot Nest
  applications and one calls a local model that holds a core for a minute.
  Jest is capped at two workers per app and CI pins `--concurrency=1`.
- **The stack has no ollama; host ports are +30000.** Since 3 September the
  agents use the shared `research-ollama` daemon on `127.0.0.1:25103`
  (`qwen3.8:27b`), and every published port is the default plus 30000 because
  other projects' containers sit on the defaults. A host-side wait against
  `11434` or `3000` talks to somebody else's service and proves nothing.

## Next

Two items are blocked on a decision, not on effort:

- **#06 order cancellation** — should cancelling restore stock? Right for a
  mistake, wrong once goods have shipped. Needs an answer before it is built.
- **#08 deploy path** — Redis Stack's RedisJSON and RediSearch rule out
  ElastiCache and MemoryDB. Self-managed Redis, Redis Cloud, or a different
  LangGraph checkpointer.

Unblocked, roughly in the order I would take them: event date sorting (#16),
public media isolation (#05), observability (#09), text search (#11), a batch
products endpoint (#18), a dedicated e2e tenant so the suites stop polluting
the demo shop (#19), server-side cart (#14), payment (#15).

The full ranked list, with evidence and file references, is the published
backlog: https://claude.ai/code/artifact/bbddcf81-6a5a-4110-ac72-3100abbeda6c
