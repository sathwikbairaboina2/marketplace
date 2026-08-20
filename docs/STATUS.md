# Status

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
- **Ollama publishes `11435`, not its default `11434`.** Any other ollama on the
  machine already answers on the default, and a host-side wait against it
  succeeds while talking to a daemon that has never heard of this project's
  model.

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
