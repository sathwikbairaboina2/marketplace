# Roadmap — from a working prototype to a Shopify competitor

**Date:** 2026-09-03 · **Branch at time of writing:** `fix/onboarding-setup-plan-gaps`
**Status:** proposal, awaiting the owner's review. Nothing in this document is built.

## 0. The honest framing

Shopify is twenty years of work, a payments company, a fulfilment network, a POS
business and an app ecosystem with thousands of third-party developers. Nobody
competes with all of that at once, and this project should not try. The way to
compete with Shopify is the way Shopify competed with Magento: pick the
merchants Shopify serves badly, serve them far better on the two or three things
they care about, and let the rest follow.

This project already has three things Shopify does not have natively:

1. **A schema that talks back.** A merchant describes their product in a chat and
   the store grows the fields it needs. Shopify needs metafields, an app, or a
   developer for that.
2. **Products and bookings in one store.** A pottery studio that sells mugs *and*
   runs classes is two apps and a headache on Shopify. Here it is one catalogue.
3. **Owner-defined order stages.** A framer's `Awaiting artwork → Mount cut →
   Glazed → Ready` is a first-class order tracker for the buyer, not a note in a
   fulfilment status.

And it has an agent-first cockpit: onboarding, setup plan, copywriter and order
support are already conversations, not forms.

**Positioning this roadmap assumes:** *the store you set up by talking to it*,
for product-and-service small businesses (makers, studios, local food, classes,
repairs) — the long tail Shopify treats as a template and an app store. If the
owner wants a different segment, sections 3 and 4 change order; section 2 does
not.

## 1. Where the project stands

What exists, verified by the test suites as of 21 August 2026:

| Area | Present today |
|---|---|
| Engine | Multi-tenant single table, tenant from token claim, 404-not-403 discipline, dynamic schema registry with agent-proposed flows, products (with free-text search, batch create, PATCH, archive), events + bookings with capacity, server-side cart, checkout into an `awaiting_payment` gate, fake card provider, owner-defined order stages with per-stage cancel and message threads, announcement, storefront draft/publish, sales stats, image upload with magic-number checks and tenant-sliced media, idempotency keys, rate limiting, RFC 9457 problems everywhere, OpenAPI with dev-token Swagger |
| Agents | LangGraph over Redis Stack checkpointer; schema-proposal graph; onboarding graph (interview → requirements → setup plan → theme + about + banners → apply); copywriter; order-support answering from the caller's own orders; local Ollama model |
| Web | Next.js 15, antd, storefront (`(shop)`) and cockpit (`(admin)`), five storefront presets with bounded overrides, live-preview onboarding wizard, registry-generated forms, dark mode, accessibility pass with axe |
| Tests | ~150 test files: contracts, engine unit + int + 16 e2e suites, agents unit + graph int-tests on a scripted LLM, web vitest, 29 playwright, 83 browser journeys, 164-case UI campaign |
| Ops | Docker Compose only. No remote, CI never run, nothing deployed |

What is structurally missing, in the order it blocks revenue:

1. **No public storefront.** Every `(shop)` route redirects to login and the
   tenant is read from the buyer's JWT. A customer with no account cannot see a
   shop, a search engine cannot index one, and there is no notion of "which
   store is this hostname". This is the single largest gap; it is architectural,
   not a feature.
2. **No self-serve merchant.** The four tenants are seeded personas in a local
   Cognito. There is no signup, no tenant provisioning, no billing.
3. **Payments are simulated.** One fake card provider, no webhooks, no refunds,
   no reconciliation.
4. **Catalogue is flat.** No variants, no collections, no discounts, no
   shipping or tax, single price and stock per product.
5. **The store never speaks to anyone.** No email or SMS for order placed, paid,
   stage advanced, message received.
6. **Nothing is deployed.** Decision #08 (Redis Stack rules out ElastiCache)
   still open; decision #06 (cancel restores stock?) still open.
7. **Themes are five fixed skins.** No sections, no editor beyond accent /
   radius / fonts / hero, no gallery, no way for a merchant to change layout.

## 2. The themes of the plan

Eight workstreams. A–C are the road to first revenue and run in sequence;
D–H run beside them once A is underway.

### Theme A — Open the doors: a public storefront

*Outcome: a stranger with no account opens `acme.example.com`, browses, adds to
cart, pays, and gets an email. Google can index the shop.*

- **Tenant resolution by host, not by token.** A `Host`-based resolver in the
  web app maps `<slug>.<platform-domain>` and mapped custom domains to a tenant
  id. The engine gains a `@Public()` read surface (`GET /shops/:slug/products`,
  `/events`, `/storefront`, `/settings/announcement`) that takes the tenant from
  the path and serves only `active` records. Existing token-scoped routes stay
  for the cockpit and for signed-in buyers. The partition key still comes from
  exactly one place per request; the public resolver becomes the second code
  path allowed to build one, tested to the same standard as `claims.ts`.
- **Server-render the storefront.** `(shop)/layout.tsx` is a client component
  that renders nothing until auth and config resolve. Move config fetch and
  theme resolution to the server (the theming spec already says so; the
  implementation did not follow it). Add `generateMetadata`, Open Graph tags,
  `sitemap.xml` and `robots.txt` per tenant, canonical URLs, product JSON-LD.
- **Guest checkout.** Cart keyed on an anonymous session (signed cookie)
  promoted to the buyer on login or on email capture at checkout. Order lookup
  by order id + email for guests.
- **Customers are not staff.** Today a buyer is a user in the tenant's pool
  with `custom:role = buyer`. Split into two identities: **staff** (owner,
  staff — Cognito, cockpit) and **customers** (a `CUSTOMER#` record per tenant,
  passwordless email-code login on the storefront). Ownership checks on orders,
  bookings and threads move to customer id.
- **Cockpit stays on its own host** (`admin.<platform-domain>`), so a storefront
  theme can never leak into the seller's tools and the CORS allow-list stays a
  list of platform hosts.

Success: journey "anonymous visitor buys a mug at `acme.localhost:3002`" green;
Lighthouse SEO ≥ 90 on a themed home page; no `(shop)` route requires a JWT.

*Progress, 2026-09-03:* tenant by host and the public read surface landed
(first slice); robots, sitemap, metadata and JSON-LD landed (SEO slice; the
shell itself is still client-rendered); guest checkout landed on a signed
ticket with lookup by id and email and cart merge on sign-in. Left in this
theme: server-rendering the shell, customers as an identity separate from
staff, and the cockpit on its own host. Lighthouse has not been run.

### Theme B — A stranger can open a shop: merchant self-serve

*Outcome: someone signs up, names their store, talks to the onboarding agent,
publishes, and is live on a subdomain in ten minutes.*

- **Signup and tenant provisioning.** `POST /tenants` (public, rate-limited,
  email-verified): creates the tenant partition, the owner in Cognito with
  `custom:tenant_id`, the default pipeline, the onboarding flag, the media
  bucket slice, and the subdomain claim. Slug uniqueness is a conditional put
  on a `SLUG#` item.
- **Staff roles.** `owner`, `staff` (and later `support`) in place of the
  single `admin`. Invitations by email. `@Roles()` and the service checks widen
  to a role set; the OpenAPI document keeps showing them.
- **Plans and billing for the platform itself.** Free tier with a platform
  banner, paid tiers by feature (custom domain, more staff, image generation).
  Stripe Billing or Razorpay Subscriptions depending on the target market
  (decision needed, section 5). Plan gates enforced in the engine, not the UI.
- **Custom domains.** A `DOMAIN#` claim per tenant with a verification TXT
  record; TLS through the hosting layer (ACM if AWS).
- **Data export and store deletion.** GDPR-shaped from day one: export
  products, orders and customers as CSV/JSON; delete the tenant with a
  cooling-off period.

Success: journey "new merchant signs up, onboards, publishes, first sale" green
end to end with no seeded persona involved.

### Theme C — Commerce depth: the catalogue a real shop needs

*Outcome: a T-shirt in four sizes and three colours is one product, a 10%
launch code works, shipping and tax appear on the order, and a refund can be
issued.*

Ordered by how often the long tail needs it:

1. **Variants.** `Product` gains `options` (name + values, max 3) and
   `variants[]` each with its own `sku`, `priceMinor`, `stock`, optional image.
   The order line references `variantId`; the stock-decrementing transaction
   conditions on the variant item. The `explainFailure` by-position rule still
   holds — line items stay first in the transaction.
2. **Collections.** Manual and rule-based (`category = x`, `attributes.y = z`),
   with a storefront route and a section in the theme engine (Theme D).
3. **Discounts.** Code and automatic; percentage, fixed, free shipping; bounds
   in minor units; applied at checkout by the engine, never by the client;
   usage limits with a conditional counter.
4. **Shipping and tax.** Flat and weight/price-banded shipping zones; tax as
   inclusive or exclusive rates per zone, with a provider interface so a tax
   service can slot in later. Order total becomes `subtotal + shipping + tax −
   discount`, all integer minor units, bounds re-checked in
   `packages/contracts/src/common.ts`.
5. **Real payments.** Second `PAYMENT_PROVIDER`: Stripe (global) and/or
   Razorpay/UPI (India). Charge with an idempotency key; webhook endpoint that
   is the source of truth for `paid`; reconciliation job for orders stuck in
   `awaiting_payment`; refunds (full, then partial) with stock restore
   decided per stage — which closes decision #06: **cancel restores stock only
   while the current stage is marked `restocks`, a third per-stage switch
   beside `cancellable` and `messageable`.**
6. **Inventory.** Low-stock alerts already exist on the dashboard; add stock
   adjustment history, "continue selling when out of stock", and a
   back-in-stock capture on the storefront.
7. **Abandoned checkout expiry.** The status doc deliberately deferred it;
   with real payments a stock reservation held forever hurts. A TTL on
   `awaiting_payment` orders that cancels and restocks.

Success: engine e2e suites for each; journey "buys a medium blue tee with code
LAUNCH10, pays with Stripe test card, seller refunds half" green.

### Theme D — Themes: from five skins to a theme engine

*This is the workstream the word "themes" points at. Outcome: a merchant
changes what their home page contains, not only what colour it is; an agent
can design a whole store from a sentence; there are a dozen presets and a
path to third-party themes.*

**D1. Theme contract v2.** Today a preset is a palette + fonts + radius + hero
style, and the tenant stores `presetId + overrides`. Extend it with layout:

```ts
Theme = {
  id, name, tokens: { light, dark, type, radius, spacing },   // code, as now
  pages: {
    home:    Section[],                 // default layout the preset ships with
    product: Section[],
    collection: Section[],
    about:   Section[],
  },
}
Section = { type: 'hero' | 'featured-collection' | 'product-grid' | 'banner'
          | 'rich-text' | 'image-with-text' | 'testimonials' | 'events'
          | 'newsletter' | 'faq' | 'contact', id, settings: SectionSettings }
StorefrontConfig += { pages?: Partial<Theme['pages']> }   // tenant's layout, data
```

Tokens stay code (a palette fix ships without a migration, as now). Section
layout becomes **data with a schema version**, validated by zod, bounded
(max sections per page, max items per section), and rendered by a registry of
React section components with strict props. No arbitrary code, no CSS
injection.

**D2. The theme editor.** Settings → Store design grows from the wizard's
preview into a visual editor: page selector, section list with add / remove /
reorder (drag or arrows), per-section settings panel (copy, image, collection
picker, layout variant), token panel for the bounded overrides, live preview
rendering the real storefront components, draft/publish as today, plus
**preview links** (a signed URL that renders the draft for an unauthenticated
viewer) and **theme history** (last ten published configs, one-click restore).
No `window.confirm`; antd `Popconfirm` for destructive steps.

**D3. Agent-designed stores.** The onboarding graph's `proposeTheme` and
`draftContent` learn sections: "a hero with your best mug, then classes this
month, then your story" becomes a `pages.home` proposal. Feedback loop
("less busy", "put classes first") edits the section list. Contrast floors and
section bounds stay in code so the model physically cannot store an unreadable
or unbounded layout. Later: **"redesign from a photo of my shop"** using the
existing optional image pipeline in reverse (vision model → palette + tone).

**D4. Preset gallery: five to twelve.** Each preset is a full skin *and* a
default section layout. Candidates, chosen to cover business kinds the segment
actually has: `bold` (streetwear, high contrast, oversized type), `luxe`
(jewellery, black + gold, sparse), `playful` (kids, toys, rounded, bright),
`outdoor` (adventure gear, photo-led hero), `minimal` (one-product brands,
white space), `bakery` (warm, image grid first), `atelier` (services and
bookings first, product grid second). Each preset ships with a build-time
thumbnail, and every preset is screenshot-verified in light and dark on home,
product, collection and about before it is listed — the house rule that found
two real defects in the first five.

**D5. Storefront rendering that themes can rely on.** Server-render the theme
(Theme A), self-host three more font faces through `next/font`, add a `--mp-*`
token layer for sections so a section never reaches for antd internals,
motion tokens with `prefers-reduced-motion`, and a per-preset print stylesheet
for order pages. Component-level visual regression: Playwright screenshots per
preset per page, diffed in CI.

**D6. Theme packaging and, later, a theme marketplace.** Presets move into
`packages/themes/<id>` (tokens + default layout + thumbnail + README) so a
theme is one directory with one owner. Third-party themes come after the
section registry has stabilised for two releases: a theme package declares
tokens and layouts only, never components, so a bad theme can make a store
ugly but never insecure. Revenue share is a business decision, not a
technical one, and comes last.

Success: journey "merchant reorders home sections, publishes, buyer sees the
new order" green; 12 presets with verified screenshots; agent produces a valid
`pages.home` for three business kinds on the scripted provider.

### Theme E — The AI moat: agents that do the work

*Outcome: the cockpit's agents are why a merchant chooses this over Shopify,
not a demo.*

- **Local model only, upgraded and evaluated.** Decision taken 2026-09-03:
  the agents service stays on Ollama in Docker; no hosted provider. The model
  moves from `qwen2.5:7b-instruct` to **`qwen3.8:27b`** (Q4 default tag). Work
  this implies: change `ollama-init` and `LLM_MODEL` in
  `docker/docker-compose.yml`; the first `docker:up` on a machine without the
  volume pulls 18 GB, so the README's boot note and `scripts/e2e.mjs` timeouts
  move with it; a 27B model at Q4 needs roughly 20 GB of RAM or VRAM, which
  becomes a documented host requirement and rules out the two-core CI runner
  for agent suites (already the case). Every graph prompt and coercion rule was
  tuned on the 7B model — the interview floor, the requirements coercion, the
  setup-plan parse — so the switch is not a config change but a re-verification:
  build an **eval set** from the graph int-tests plus the real onboarding
  transcripts already in Redis (does the interview stop at the right time, does
  the setup plan parse, does the theme match the business) and run it on both
  models before the tag changes. The LLM interface stays a seam so a hosted
  provider could be added later, but none is planned.
- **Merchandising agent.** "Which products should I feature this week?" over
  `stats/sales` and stock; writes a collection proposal, never a publish.
- **Catalogue import agent.** Paste a CSV, an Instagram grid, or a supplier
  list; the agent maps it to `POST /products/batch` and proposes the fields the
  registry lacks. This is the growth loop: the faster a real catalogue lands,
  the sooner a merchant is live.
- **Support agent with actions.** Today it answers from orders. Let it
  *propose* actions — "issue a refund for order 1234", "move it to Ready" —
  that the seller confirms with one click, through the existing propose-then-
  human-executes pattern that every agent path in this codebase follows.
- **Pricing and copy assistants** extend the copywriter: per-variant
  descriptions, SEO titles, alt text for every uploaded image (accessibility
  and search in one).
- **Guardrails as contracts.** Every agent output is a zod schema with bounds,
  as now; add a per-tenant token budget and a per-thread turn cap, surfaced
  as problem documents.

### Theme F — The store speaks: notifications

- **Transactional email** through a provider interface (SES on AWS; a
  console-logging provider in Docker): order placed, payment received, stage
  advanced (using the owner's stage names), new message in a thread, booking
  confirmed, low stock, invitation. Templates carry the tenant's theme accent
  and logo.
- **Merchant alerts** in the cockpit (bell + list) for new orders, messages and
  failed payments, over a `NOTIFICATION#` item per staff user.
- **Buyer opt-ins**: back-in-stock, newsletter capture section (Theme D).
- **Abandoned cart email** once guest checkout captures an email (Theme A).
- SMS/WhatsApp deferred until a market is chosen (section 5).

### Theme G — Platform and operations: actually shipping it

Nothing above matters until this is true.

- **Phase 0 hygiene (this week):** merge `fix/onboarding-setup-plan-gaps`,
  create a remote, push, watch CI run for the first time and fix what a
  runner finds that this machine did not (it will find something).
- **Deploy path (decision #08).** Recommendation: AWS, since DynamoDB, SQS,
  S3 and Cognito were chosen and LocalStack already mirrors them. Engine and
  agents on ECS Fargate, web on the same or on Vercel, DynamoDB on-demand,
  SQS FIFO, S3 + CloudFront for media, Cognito. For the checkpointer, **run
  Redis Stack on a single small EC2/ECS task for now** rather than block on
  ElastiCache; revisit with a DynamoDB checkpointer if the LangGraph ecosystem
  ships one. Two environments: staging (seeded demo tenants) and production.
- **Infrastructure as code** (CDK, TypeScript, same language as everything
  else) in `infra/`, with the Compose file remaining the local truth.
- **Observability.** Pino logs already carry ids; add OpenTelemetry traces
  across web → engine → agents → SQS, a metrics dashboard (request latency,
  transaction conflicts, agent turn latency, model tokens per tenant), and
  alerts on DLQ depth and `awaiting_payment` age.
- **Security.** Content Security Policy with a nonce through Swagger and the
  console (the deferred item); secrets in a manager, not env files; dependency
  audit in CI; a real penetration pass on the public storefront before launch
  because it is the first unauthenticated surface with tenant-controlled
  content in it.
- **Backups and restore drills.** DynamoDB PITR, S3 versioning, a scripted
  restore that is run, not just written.
- **Load tests** on checkout: the stock-reserving transaction under contention
  is the one path whose behaviour differs between DynamoDB Local and the real
  table (`ConditionalCheckFailed` vs `TransactionConflict`, as the house rule
  notes). Assert outcomes on a real table before real money.

### Theme H — Extensibility: the beginnings of an ecosystem

Deliberately last. Shopify's app store is a moat because of scale this project
does not have yet; build the primitives, not the store.

- **Webhooks** per tenant for order, payment, product and booking events, signed
  with a per-tenant secret, delivered through the existing SQS pattern with
  retries and a DLQ.
- **API keys** for staff (scoped, revocable) so a merchant's own tools can call
  the same OpenAPI-documented surface the cockpit uses.
- **Import/export** for products, customers, orders (also Theme B's export).
- **Theme packages** (Theme D6) are the first "third-party" surface; apps
  come after there are merchants asking for a specific integration.

## 3. Engineering debt to pay along the way

Not a theme; folded into whichever workstream touches the file.

- `(shop)` shell renders nothing until three client fetches resolve; Theme A
  makes it server-first.
- `orders.service.ts` now holds create, advance, cancel, pay and the
  transaction explainer; split by concern before variants land on top.
- The `@Roles('admin')` + service-check pair is repeated per route; a shared
  `assertRole` helper with one test would remove the drift risk when roles
  widen in Theme B.
- Products written before the search blob existed do not match text search;
  a one-off backfill command belongs in `scripts/` before there are real
  tenants.
- The web build lints and typechecks; add `tsc --noEmit` as a `typecheck`
  script per package so CI's inline commands live in one place.
- Browser suites take minutes; shard journeys by section in CI.

## 4. Sequencing and rough sizing

Sizes assume one engineer working the way this repo has been worked: spec →
plan → TDD → browser journeys → screenshots. Weeks are calendar weeks.

| Phase | Weeks | Contents | Done when |
|---|---|---|---|
| 0 — Ship what exists | 1 | Theme G hygiene: merge, remote, CI green, staging deploy on AWS, decisions in section 5 taken | Demo tenants reachable on a real URL |
| 1 — A stranger can buy | 5–6 | Theme A entire; Theme C.5 real payments in test mode; Theme F order emails | Anonymous purchase journey green on staging |
| 2 — A stranger can open a shop | 4–5 | Theme B signup, roles, subdomains; Theme E model upgrade to `qwen3.8:27b` behind the eval set | Self-serve merchant journey green; first external tester |
| 3 — A real catalogue | 6–8 | Theme C.1–C.4, C.6, C.7 | Variant + discount + shipping journey green |
| 4 — Themes v2 (parallel from phase 2) | 6–8 | Theme D1–D5 | Section editor shipped, 12 presets verified |
| 5 — The store speaks and the agents work | 4–6 | Theme F remainder; Theme E merchandising, import, support actions | Import-a-CSV-and-go-live under 15 minutes |
| 6 — Ecosystem | ongoing | Theme H, D6 | First webhook consumer; first external theme |

Roughly six to eight months to a product a real merchant could run a real
shop on, with revenue possible after phase 2.

## 5. Decisions the owner must take before phase 1

These change the work materially; the plan above states the assumption it
proceeds under if no answer arrives.

1. **Target market and currency for payments.** Stripe (global card) or
   Razorpay/UPI (India) first? *Assumed: Stripe test mode first because it is
   provider-agnostic to build against; Razorpay as the second provider.*
2. **Hosting.** AWS as recommended, or a single VPS running the Compose stack
   as a cheaper first step? *Assumed: AWS, staging first.*
3. **Model provider.** *Taken 2026-09-03: local Ollama in Docker only, model
   `qwen3.8:27b`. No hosted provider.*
4. **Cancel restores stock (decision #06).** *Assumed: per-stage `restocks`
   switch, default on for stages before the first "shipped"-like stage the
   owner marks.*
5. **Positioning.** Product-and-service long tail as argued in section 0, or a
   different wedge? This changes the preset gallery and the order of Theme C.

## 6. What this plan deliberately does not include

- Point of sale, fulfilment network, shipping label purchase, dropshipping.
- Multi-store per merchant, B2B wholesale pricing, multi-currency selling.
- A native mobile app. The storefront becomes a good PWA instead.
- An app store. Primitives first (Theme H); the store when merchants ask.
- Replacing antd in the cockpit. The storefront gets its own section
  component set (Theme D5); the cockpit keeps what works.
