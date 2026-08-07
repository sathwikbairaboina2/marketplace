# Marketplace

Multi-tenant commerce and booking platform. Two services, decoupled by an SQS
FIFO queue:

- **MarketplaceEngine** — the deterministic core: CRUD, tenant isolation, and an
  enforcing per-tenant dynamic schema registry.
- **MarketplaceAgents** — the conversational layer: a LangGraph.js state machine
  that turns a chat into a validated schema-change proposal and puts it on the
  queue. It owns no database.

Specs and plans:

- `docs/superpowers/specs/2026-08-03-marketplace-engine-design.md`
- `docs/superpowers/plans/2026-08-03-marketplace-engine.md`
- `docs/superpowers/specs/2026-08-03-marketplace-agents-design.md`
- `docs/superpowers/plans/2026-08-03-marketplace-agents.md`

## Layout

| Path | Contents |
|---|---|
| `apps/engine` | NestJS service: auth, products, events, orders, bookings, flows, and the SQS consumer that turns AI-proposed flows into records |
| `apps/agents` | NestJS service: an authenticated WebSocket gateway backed by a LangGraph.js state machine that turns a chat into a validated schema-change proposal and, on confirmation, pushes a `PROPOSE_FLOW` message onto the queue `apps/engine`'s consumer reads |
| `apps/web` | Next.js console: a browser client for both services, whose forms, filters and detail rows for tenant-defined `attributes` are generated from the schema registry rather than hand-written |
| `packages/contracts` | Zod schemas — the single source of truth for entity shapes |
| `packages/auth` | Shared JWT verifier and tenant context |
| `docker/` | Compose stack and infrastructure seeding |

## Running

```bash
pnpm install
pnpm --filter @marketplace/web exec playwright install chromium   # one-time, for `pnpm e2e`
pnpm docker:up      # dynamodb-local, localstack (sqs + s3), redis, cognito-local, seed, engine, ollama, ollama-init, agents, web
pnpm test           # unit + integration
pnpm e2e            # engine suite, then agents suite, then web suite, then tears down
pnpm docker:down
```

`pnpm docker:up` runs the `seed` container first. It creates the DynamoDB table,
the FIFO queue and its DLQ, and a Cognito user pool, then writes the generated
identifiers to `docker/.env.generated`, which both the engine and agents
containers read.

`engine` serves on `:3000`, `agents` on `:3001`, both under `/api/v1`; the `web`
console is on `:3002`.
`agents`' readiness (`GET /api/v1/health/ready`) is only green once Redis
answers, the engine reports ready, *and* Ollama has actually pulled the
configured model (`qwen2.5:7b-instruct` by default) — not just that Ollama is
listening. That model is 4.7GB: the **first** `pnpm docker:up` on a machine
with no cached volume can take several minutes while `ollama-init` pulls it.
Subsequent runs reuse the `ollama-models` Docker volume and start in seconds.

`pnpm docker:down` and `pnpm e2e`'s automatic teardown both preserve that
volume deliberately — neither ever runs `docker compose down -v`, which would
delete it and force the next `docker:up` to re-download 4.7GB. They do still
wipe the rest of the stack's state (in particular the Cognito pool), so every
run still starts from a clean data plane; only the cached model survives.

With the stack up, Swagger UI is at `http://localhost:3000/api/v1/docs` (engine)
and `http://localhost:3001/api/v1/docs` (agents). Each page authorizes itself on
load: it calls its own `POST /api/v1/dev/token`, a dev-only endpoint that mints a
Cognito ID token for a fixed identity (`DEV_TENANT_ID`/`DEV_USERNAME`) and hands
it to Swagger UI's "Try it out". Neither the docs page nor `/dev/token` exists
unless `DOCS_ENABLED=true` **and** `COGNITO_ENDPOINT` is set — true only in
`docker/docker-compose.yml`, never in a deployed build.

## The console

`http://localhost:3002` is a browser client for both services. Sign in with one
of three seeded personas, all sharing the password `Passw0rd!`:

| Username | Tenant | Role |
|---|---|---|
| `acme-admin` | `acme` | `admin` |
| `acme-buyer` | `acme` | `buyer` |
| `globex-admin` | `globex` | `admin` |

`globex-admin` exists so tenant isolation is visible rather than merely
asserted: signed in as Globex, none of Acme's catalogue is reachable, including
by pasting a product URL.

Sign-in posts to `/api/login`, a Next.js route handler that calls Cognito
server-side; every other request goes straight from the browser to the engine's
REST API or the agents' WebSocket. The persona list and that password come from
`DEV_PERSONAS`/`DEV_PASSWORD`, read per request by `/api/personas` and absent
from any build that does not set them.

Role selects which navigation is shown and nothing more. **It is not an
authorization boundary** — the engine enforces tenant isolation on every route
and enforces nothing about role, so an admin URL typed by hand works perfectly
well for a buyer.

An admin can attach photographs when creating a product. The browser posts each
file to the engine, which checks its size and reads its magic number — a
declared `image/png` that is really an HTML document is refused — and then
writes it to the `marketplace-media` bucket in LocalStack. The stored objects
are **public-read by design**, so an `<img>` can load one with no credentials
and no signing round-trip; tenant isolation therefore does not extend to an
image URL. Images can only be set when a product is created, because the engine
has no update routes.

The console has two faces. `/admin/*` is a back-office: a dark sidebar grouped
into Catalogue, Sales and Schema, with the tenant shown prominently in its foot
because switching between `acme` and `globex` is how tenant isolation reads.
Everything else is a storefront: a light header, a hero describing the catalogue
from live data, a persistent filter rail and a product grid. Both share one
palette, and a theme toggle switches light and dark; the choice is stored in
`localStorage` under `marketplace.theme` and applied before first paint, so
nothing flashes on load.

Below `lg` the sidebar becomes a drawer, and below `md` the filter rail becomes
a sheet. Tables scroll horizontally rather than reflowing -- cursor pagination
gives no total to summarise, so there is no honest narrow layout for them.

Forms, search filters and detail rows for tenant-defined `attributes` are
generated from `GET /schemas`. Executing a flow raises the registry version and
the console re-reads it, so a field an agent proposed appears everywhere it
belongs without a page reload and without a line of UI code naming it.

## The conversation

A client connects a WebSocket to `/agents` on port 3001, passing a Cognito ID
token in the socket.io handshake `auth.token`. Events are `thread.start`,
`thread.resume`, `message`, `confirm`, `reject`; the server replies with `state`
snapshots and `error` problem documents. Every payload shape is exported from
`@marketplace/contracts`.

Confirming a proposal does not change any schema. It queues a `PROPOSE_FLOW`
message; the Engine records a Flow at `status: 'proposed'`, and a human applies
it with `POST /api/v1/flows/:id/execute`.

## API surface

All routes are under `/api/v1` and require a valid Cognito ID token (`Authorization: Bearer
<token>`) except `/health/live` and `/health/ready`.

| Method & path | Purpose |
|---|---|
| `POST /products` | Create a product |
| `GET /products` | List the tenant's products (paginated) |
| `GET /products/:id` | Get a product by id |
| `POST /products/search` | Search products by core fields and dynamic `attributes` |
| `POST /events` | Create an event |
| `GET /events` | List the tenant's events (paginated) |
| `GET /events/:id` | Get an event by id |
| `POST /orders` | Place an order (locks unit prices, decrements stock transactionally) |
| `GET /orders` | List the caller's own orders (paginated) |
| `GET /orders/:id` | Get one of the caller's own orders |
| `POST /bookings` | Book event tickets (enforces capacity transactionally) |
| `GET /bookings` | List the caller's own bookings (paginated) |
| `GET /bookings/:id` | Get one of the caller's own bookings |
| `POST /flows` | Propose a schema change (`status: 'proposed'`, never auto-applied) |
| `POST /flows/:id/execute` | Apply a proposed Flow's diff to the tenant's registry |
| `GET /flows` | List the tenant's flows (paginated) |
| `GET /flows/:id` | Get a flow by id |
| `POST /uploads/product-image` | Store a product image (multipart `file`); returns its public URL |
| `GET /me` | Return the caller's verified tenant/user/role, for debugging |

List endpoints accept `?limit=` (1-100, default 25) and `?cursor=` (an opaque, base64-encoded
`LastEvaluatedKey`) and return `{ items, nextCursor }`.

## Idempotency

`POST /orders` and `POST /bookings` accept an `Idempotency-Key` header. It is required, not
optional — clients and load balancers retry, and neither double-charging nor double-booking is
acceptable. Submitting the same key twice for the same tenant and user returns the stored
response from the first request rather than creating a second order or booking; submitting it
again while the first request is still in flight returns `409 request-in-progress`. Keys are
scoped per tenant *and* per user (`idem:<tenantId>:<userId>:<key>`), so two different users
cannot collide on a key one of them chose and read each other's response.

## Invariants

These five properties are asserted end to end against the full Docker stack, not just unit
tested:

1. **Tenant isolation** — a request for another tenant's resource by exact id returns 404, never
   403 or the resource itself.
2. **No oversell** — concurrent bookings against a capacity-limited event never exceed capacity;
   losers get 409, not a corrupted counter.
3. **No overselling stock** — the same guarantee for concurrent orders against limited product
   stock.
4. **Idempotency** — the same `Idempotency-Key` submitted twice produces exactly one order (or
   booking) and one stock decrement (or capacity claim), never two.
5. **Flow lifecycle** — a proposed Flow never mutates the registry until a human calls
   `POST /flows/:id/execute`; executing it is itself idempotent (re-executing an applied Flow
   does not bump the version a second time).

## Design notes

- **Tenant isolation** — the tenant comes only from the `custom:tenant_id` claim
  on the ID token. `DynamoRepository` is the only code that builds a partition
  key, and its methods take no tenant argument, so a cross-tenant query cannot be
  written. Cross-tenant reads return 404, never 403.
- **Dynamic attributes** — each tenant has a schema registry record per entity
  type. Every write validates `attributes` against it. Flows mutate the registry.
- **Add-only schema changes** — there is no backfill, so field removal and type
  changes are rejected. Attributes added by a Flow are absent from records
  written earlier, and `POST /products/search` will not match those records.
- **Money** — integer minor units plus an ISO-4217 currency. Never floats.
- **Concurrency** — stock and event capacity are enforced by DynamoDB condition
  expressions inside `TransactWriteItems`, not by read-then-write in application
  code.
- **AI-proposed schema changes never auto-apply** — the SQS consumer
  (`apps/engine/src/messaging`) turns a `PROPOSE_FLOW` message into a Flow at
  `status: 'proposed'` and nothing more; only a human calling
  `POST /flows/:id/execute` can apply it. The consumer is a second,
  unauthenticated entry point for a tenant id — unlike every HTTP route, it has
  no JWT behind it — so it re-validates the tenant id against the same pattern
  the auth chokepoint (`claims.ts`) enforces before that value ever reaches a
  DynamoDB key. A message that fails validation, fails schema parsing, or is
  not valid JSON is left unacknowledged rather than deleted, so the queue's
  redrive policy (`maxReceiveCount: 5`) moves it to the DLQ for forensics
  instead of discarding it silently. Redelivery is deduplicated per `messageId`
  in Redis so a retried message never creates a second Flow. The queue is FIFO
  with `MessageGroupId` set to the tenant id, so a poison message (one that
  keeps failing, e.g. malformed JSON) head-of-line-blocks the rest of *that
  tenant's* queued messages for up to five receive attempts before it moves to
  the DLQ and processing for that tenant resumes — other tenants' groups are
  unaffected.
