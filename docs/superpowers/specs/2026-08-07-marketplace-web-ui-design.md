# MarketplaceWeb: a Next.js console for the engine and the agents

**Date:** 2026-08-07
**Status:** approved, not yet implemented

## Purpose

Give the platform a browser client. Today the only ways to exercise the two
services are Swagger UI, `curl`, and the e2e suites. None of them show the thing
the platform actually claims: that a conversation with an agent can add a field
to a tenant's schema, and that the field then exists everywhere — in the create
form, in the search filters, on the detail page — without anyone writing UI code
for it.

One application serves both sides of the marketplace, buyer and admin, chosen by
the signed-in user's role. It runs in the local Docker stack alongside everything
else and is verified end to end by Playwright, not by hand.

Audience is local development. This is a console for exercising and demonstrating
the platform, not a production storefront. It is not styled to a brand, has no
payment integration, and no analytics.

## Current state

- Two NestJS services: engine on `:3000`, agents on `:3001`, both under
  `/api/v1`. 22 HTTP routes on engine, 3 on agents.
- `packages/contracts` holds every entity and wire shape as a Zod schema, and is
  a workspace package any app can import.
- Auth is a Cognito ID token as `Authorization: Bearer`, verified by
  `packages/auth`. Claims carry `custom:tenant_id`; `claims.ts` also reads
  `custom:role`, but **nothing sets it and no route enforces it** — `role` is
  `null` for every token the system currently mints.
- `docker/seed/cognito.ts` creates the user pool and client and **creates no
  users**. The pool's `Schema` declares `tenant_id` only. `USER_PASSWORD_AUTH`
  and `ADMIN_NO_SRP_AUTH` are both enabled on the client.
- `POST /api/v1/dev/token` exists behind `DOCS_ENABLED`, takes no body, and mints
  a token for the fixed `DEV_USERNAME`/`DEV_TENANT_ID` identity.
- **Engine has no CORS.** The agents WebSocket gateway is
  `@WebSocketGateway({ namespace: '/agents', cors: { origin: '*' } })`.
- `GET /schemas` and `GET /schemas/:entityType` return the tenant's dynamic field
  definitions. They are absent from the README's route table.
- `DynamicEntityTypeSchema` is `['Product', 'Order', 'Event', 'Booking']` — all
  four carry tenant-defined `attributes`, not just Product.
- No frontend of any kind exists in the workspace.

## Approach

A new workspace at `apps/web`: Next.js App Router, ANTD v5, served on `:3002`,
added to `docker/docker-compose.yml` after `engine` and `agents` are healthy.

### The browser/backend boundary

Three channels leave the browser:

| Channel | Target | Why |
|---|---|---|
| `POST /api/login` | Next route handler → cognito-local `InitiateAuth` | server-side; sidesteps the unverified question of whether cognito-local emits CORS headers |
| REST | engine `:3000/api/v1`, direct | ~20 routes; proxying each one buys nothing |
| WebSocket | agents `:3001/agents`, direct | the gateway is already `cors: { origin: '*' }` |

A full BFF — every engine call proxied through a route handler, ID token in an
httpOnly cookie — was considered and rejected. The agents socket needs the token
in `auth.token` from browser JavaScript, so an httpOnly cookie would require a
"hand me the socket token" endpoint that re-exposes it anyway. The isolation
would be ceremony, paid for with twenty proxy handlers. Login is routed through
the server because that is the one place it removes a real unknown.

The token lives in a React context, mirrored to `sessionStorage` so a refresh
does not sign the user out. On load, `GET /me` validates it and returns
`{ tenantId, userId, role }`; `role` selects the navigation.

Environment splits by execution context, and getting this wrong is the most
likely first-run failure:

- The login route handler runs **inside the container**:
  `COGNITO_ENDPOINT=http://cognito-local:9229`.
- Everything else runs **in the browser**:
  `NEXT_PUBLIC_ENGINE_URL=http://localhost:3000/api/v1`,
  `NEXT_PUBLIC_AGENTS_URL=http://localhost:3001`.

Container hostnames are unresolvable from the browser.

### Dependencies and the container

Two ANTD packages are non-optional on App Router and easy to omit:

- **`@ant-design/nextjs-registry`** — wraps the root layout so ANTD's CSS-in-JS
  is extracted during SSR. Without it every page flashes unstyled before
  hydration.
- **`@ant-design/v5-patch-for-react-19`** — Next.js ships React 19, and ANTD v5
  was built against React 18's rendering entry points. Without the patch,
  `message`, `notification` and `Modal` — all of which the error path in this
  design depends on — log compatibility errors and can fail to mount.

The `web` service builds a production image (`next build` then `next start`), not
a dev server. The e2e suite should exercise what a build produces, and a dev
server in a container would need a bind mount and would make the suite's timing
depend on on-demand compilation. Docker layer caching keeps the rebuild cost off
the common path.

### Backend changes

Two, both small, both off by default.

**1. `docker/seed/cognito.ts`** — add `role` to the pool's `Schema`, then create
demo users with permanent passwords and both custom attributes:

| Username | `custom:tenant_id` | `custom:role` |
|---|---|---|
| `acme-admin` | `acme` | `admin` |
| `acme-buyer` | `acme` | `buyer` |
| `globex-admin` | `globex` | `admin` |

The third tenant exists so isolation can be demonstrated in the UI rather than
asserted in a test file. All three share one fixed development password, a
literal constant in the seed. The login screen reads the persona list and that
password from a Next route handler, `GET /api/personas`, **not** from a
`NEXT_PUBLIC_*` variable: `NEXT_PUBLIC_*` values are inlined into the bundle at
`next build`, so anything compose supplies afterwards is ignored. A route handler
reads its environment at request time, which is what a value originating from the
seed requires. The password is a development convenience with no path into a
deployed build, exactly like `/dev/token`; `/api/personas` returns an empty list
unless the same flag that enables it is set.

On a real Cognito user pool the schema is immutable after creation, and the seed
finds the pool by name rather than recreating it, so an existing pool would
silently lack `custom:role` and `AdminCreateUser` would reject the attribute.
Whether cognito-local enforces the declared schema at all is **unverified** — it
is a mock and may well accept the attribute regardless. Probe it first: attempt
`AdminCreateUser` with `custom:role` against the existing pool. If it fails, the
fix is a one-time `docker volume rm marketplace_cognito-data`, which is targeted
and does not touch the 4.7GB `ollama-models` volume that `docker:down` and the
e2e teardown deliberately preserve. The drop is harmless either way — the seed
recreates the pool — so it is the documented remedy in the README regardless of
how the probe lands.

**2. Engine CORS** — `app.factory.ts` calls `app.enableCors` when a new
`CORS_ORIGINS` env var is non-empty, following the `DOCS_ENABLED` pattern already
in `apps/engine/src/config/env.schema.ts`. Empty is the default, so deployed
builds are byte-for-byte unchanged in behaviour.

Nothing else in engine or agents changes.

### The registry-driven field engine

The only genuinely novel unit, and the one that carries the product thesis.
`lib/schema-fields/` is pure functions over `EntitySchemaRecord['fields']` — no
React state, no fetching, testable without a DOM.

| Export | Signature | Consumers |
|---|---|---|
| `toFormItems` | `fields → ReactNode[]` | create product, create event, order and booking forms |
| `toFilterItems` | `fields → ReactNode[]` | product search |
| `toDescriptionRows` | `(fields, attributes) → ReactNode[]` | every detail page |
| `toAttributes` | `(fields, formValues) → Record<string, unknown>` | every submit path |

All four entity types in `DynamicEntityTypeSchema` carry `attributes`, so order
and booking creation get generated fields too, not just Product and Event.

Type-to-control mapping:

| `FieldType` | Control | Wire value |
|---|---|---|
| `string` | `Input` | string |
| `number` | `InputNumber` | number |
| `boolean` | `Switch` | boolean |
| `date` | `DatePicker` | ISO 8601 string |
| `string[]`, `number[]` | `Select mode="tags"` | array, numerics coerced |
| `boolean[]`, `date[]` | `Form.List` of the scalar control | array |

`required: true` becomes an ANTD rule; `default` becomes `initialValue`.
`toAttributes` exists because ANTD returns Dayjs objects and tag-mode strings
while the wire needs ISO strings and real numbers — that coercion is the part
most worth unit-testing.

**Filters are constrained by the API, not by taste.**
`SearchProductsSchema` types `attributes` as
`Record<string, string | number | boolean>`: scalar equality only, no ranges and
no array matching. `toFilterItems` therefore emits controls for `string`,
`number` and `boolean` and skips every array type. `date` would pass as a string,
but exact-match on a timestamp is useless, so it is skipped as well. Range
filtering exists only on the core `priceMinor` field, as a hand-written control.

`GET /schemas` returns every dynamic entity's schema in one response —
`{ items: SchemaView[] }`, where `SchemaView` is
`{ entityType, version, fields }`. So `useSchemas()` makes that single call and
caches all four, and `useSchema(entityType)` is a selector over the cache rather
than a fetch of its own. Executing a flow raises the registry `version`, so the
execute success handler evicts the one cache entry and every consumer re-reads.
That eviction is the mechanism by which a new field appears without a page
reload.

### Screens

Every data page is a client component. The token lives in the browser, so there
is no server-side data fetching: Next.js here is a SPA shell plus one route
handler. Server-rendering the data would mean solving token transport a second
time for no benefit on a development console.

```
/login                      persona form; a dropdown prefills the seeded users
/products                   list, generated filters, core price range
                            (GET /products unfiltered; POST /products/search
                            as soon as any filter is set)
/products/[id]              detail, generated attribute rows, qty → add to cart
/cart                       line items, quantities, shipping address, place order
/orders  /orders/[id]       the caller's own
/events  /events/[id]       detail, book N tickets
/bookings  /bookings/[id]   the caller's own
/admin/products/new         core fields + generated attribute fields
/admin/events/new           same
/admin/flows                proposed and executed
/admin/flows/[id]           the added fields, and Execute
/admin/chat                 the agent WebSocket
```

Navigation comes from `/me`'s `role`: `buyer` sees the buyer set, `admin` sees
the admin set plus the buyer set, because admins browse their own catalogue.

**This is navigation, not authorization.** The engine enforces tenant isolation
on every route and enforces nothing whatsoever about role. An admin URL typed by
hand will work for a buyer. `packages/contracts/src/flow.ts` says so directly
about the most consequential route in the system: a Flow "permanently mutates the
tenant's data model with no per-record ownership check (any authenticated member
of the tenant may propose or execute one)", with `proposedBy`/`executedBy` as the
only record of who did it. Stating this here so the spec cannot be read as
claiming a security boundary it does not build.

**Flows are add-only, so the flow UI is add-only.** `CreateFlowSchema` fixes
`actionType` to the literal `'ADD_FIELDS'`, and `BlueprintDiffSchema` is
`.strict()` around `addedFields` alone — `removedFields` and `changedFields` are
unrecognized keys and are rejected. The flow detail page therefore renders a list
of added fields, not a two-sided diff, and no removal or type-change affordance
is built anywhere. The same holds for the chat's `draftPayload`, which is a
`BlueprintDiff`.

Cart is client-only state — a context mirrored to `sessionStorage`, keyed by
product id, holding `{ productId, name, priceMinor, qty }`. The engine has no
cart concept. `POST /orders` locks unit prices at order time, so a stale cached
price is a display concern and never a correctness one. Checkout also collects
`currency` and `shippingAddress`, both of which `CreateOrderSchema` requires.

Lists cannot use ANTD `Table` pagination: it needs a `total`, and the API returns
`{ items, nextCursor }` with no count. Lists render a `Table` with pagination
disabled and a "Load more" button that appends. Accumulated pages stay in memory
across back-navigation.

### Agent chat

`AgentStateSnapshotSchema` is documented as *"What the server emits on every
halt. The client renders from this and nothing else."* The design takes that
literally: the page holds one `AgentStateSnapshot | null` and derives every pixel
from it. No parallel message array, no locally-guessed phase.

Two panes. Left is `messages` as a transcript plus the composer. Right is the
proposal: `targetEntity`, the `draftPayload` diff, and `missingRequirements` and
`validationErrors` when non-empty.

`phase` drives the controls, and nothing else does:

| `phase` | Composer | Confirm / Reject |
|---|---|---|
| `gathering`, `drafting`, `validating` | enabled | hidden |
| `awaiting_confirmation` | disabled | enabled |
| `done` | disabled | hidden |

The socket connects with `auth: { token }` and emits `thread.start`. The
`threadId` is kept in `sessionStorage`, so a reload emits `thread.resume` rather
than starting a new thread. The `error` event carries an RFC 9457 problem and
renders through the same path as a REST failure.

**After Confirm, the client is deliberately blind.** Confirming does not create a
Flow; it puts a `PROPOSE_FLOW` message on the SQS queue. The engine's consumer
picks it up on its own schedule, and only then does a Flow record exist. The
snapshot yields `dispatchedMessageId` and `phase: 'done'`, and that is everything
the socket will ever say about it.

So on `done` the page shows "Proposal queued" with a link to `/admin/flows`, and
the flows list — when entered carrying a `dispatchedMessageId` — polls every 2
seconds for up to 30 seconds behind a visible "waiting for the proposal to
arrive" banner. On timeout the banner becomes "not here yet — refresh", not an
error, because nothing is broken at 30 seconds; the queue is merely slow. This
polling window is the honest cost of the decoupled queue.

### API client and errors

`lib/api/http.ts` is the single egress point:

```
request(path, { method, body, query, schema, idempotencyKey })
```

It attaches the bearer token, parses the response, and validates it with the Zod
schema imported from `@marketplace/contracts`. Per-resource modules
(`products.ts`, `orders.ts`, …) are thin wrappers choosing a path and a schema.
No client generator: the contracts package is already in the workspace, so types
and runtime validation come free and drift is impossible. Generating a client
would add a build step to re-derive what exists.

Failure has three shapes, and collapsing them would lose information:

- **`ProblemError`** — an `application/problem+json` body. `type`, `title` and
  `status` are required; the filter always adds `instance` and `traceId`, and
  `ZodValidationPipe` attaches `errors[]` on a 400. Rendered as an ANTD
  notification carrying the title, detail and **`traceId`** — that ID is what
  makes a failure traceable to server logs. Where `errors[]` field names match
  form fields, they are mapped onto those fields instead.
- **`ContractMismatchError`** — the request succeeded but the response failed
  `schema.parse`. Not a user error: it means client and server disagree about a
  shared package. It gets a persistent banner, not a dismissable toast.
- **401** — clear the token, redirect to `/login`.

### Idempotency

`POST /orders` and `POST /bookings` require an `Idempotency-Key`. The key is
minted with `crypto.randomUUID()` when the **intent forms** — arriving at cart
checkout, opening the booking form — not when the button is clicked. Every retry
of that intent reuses it. A new key is minted only after success or an explicit
abandon.

That ordering is what makes the retry path correct rather than merely present:

- Double-clicked submit → same key → the engine returns the stored first
  response → one order. The button is disabled as well, but correctness does not
  depend on it.
- `409 request-in-progress` → the first attempt is still in flight → back off
  (500ms, 1s, 2s, up to five tries) with the **same** key, surfacing only if it
  never resolves.
- Network drop mid-request → retry with the same key → the original response, no
  duplicate order.

Minting at click time breaks all three.

## Testing

**Unit — Vitest and Testing Library.** The pure logic, no stack required:
`toAttributes` coercion per field type, `toFilterItems` skipping arrays and
dates, `ProblemError`/`ContractMismatchError` mapping, the idempotency key
lifecycle, the cart reducer.

**End to end — Playwright.** `web` joins `docker-compose.yml` and
`scripts/e2e.mjs` gains a third `--filter @marketplace/web test:e2e` step after
the agents suite and **before** the `pnpm docker:down` teardown, following the
existing `if (code === 0)` chain so a failure short-circuits the rest.
Playwright drives `http://localhost:3002` from the host, which makes
`npx playwright install` a one-time setup cost beside `pnpm install`. Teardown
continues to preserve `ollama-models`.

The paths worth the wall-clock:

1. Sign in as `acme-admin`; `/me` reports tenant `acme`.
2. Create a product through the generated form; it appears in the list.
3. As `acme-buyer`: search by a dynamic attribute, add two products to the cart,
   place one order, open the order detail.
4. Book event tickets.
5. **Isolation** — `globex-admin` sees none of Acme's products, and an Acme
   product id 404s.
6. **Idempotency** — a double submit yields exactly one order.
7. **The loop** — a flow executes and the product form grows a field.

**Test 7 is split deliberately.** The full chat-to-field loop runs through Ollama
`qwen2.5:7b-instruct`, and a language model will not produce the same diff twice.
Asserting on generated field names would manufacture flake.

- **7a, deterministic:** create the flow via `POST /flows` with a known diff,
  execute it, assert the named field appears in the product form. This is the
  assertion that proves the registry-driven engine works, and it never touches
  the model.
- **7b, loose:** open chat, send a message, assert only that `phase` reaches
  `awaiting_confirmation` with a non-empty `draftPayload`. This proves the
  socket, the graph and the phase machine, and asserts nothing about the model's
  word choices.

The post-confirm SQS wait is a poll against `/flows`, never a fixed sleep. A
sleep tuned on a fast machine is the likeliest source of CI flake in this suite.

## Out of scope

- Production deployment of the web app. It is a compose service.
- Real payment, shipping or fulfilment.
- Server-side rendering of data, and any SEO consideration that would demand it.
- Role enforcement in the engine. Role remains a navigation hint; adding
  authorization is a separate change to the services.
- Editing or deleting products, events, orders or bookings — the engine exposes
  no update or delete routes.
- Generating a typed client from the OpenAPI document. The contracts package
  already provides both types and validation.
- Theming, branding and responsive design beyond what ANTD gives by default.
