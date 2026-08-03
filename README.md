# Marketplace

Multi-tenant commerce and booking platform. This repository currently contains
**MarketplaceEngine**, the deterministic core service.

- Design spec: `docs/superpowers/specs/2026-08-03-marketplace-engine-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-03-marketplace-engine.md`

## Layout

| Path | Contents |
|---|---|
| `apps/engine` | NestJS service: auth, products, events, orders, bookings, flows, and the SQS consumer that turns AI-proposed flows into records |
| `packages/contracts` | Zod schemas — the single source of truth for entity shapes |
| `docker/` | Compose stack and infrastructure seeding |

`MarketplaceAgents`, the LangGraph orchestrator that pushes `PROPOSE_FLOW`
messages onto the queue this service consumes, is specified separately and is
not part of this repository.

## Running

```bash
pnpm install
pnpm docker:up      # dynamodb-local, localstack (sqs), redis, cognito-local, seed, engine
pnpm test           # unit + integration
pnpm e2e            # full stack end to end, then tears down
pnpm docker:down
```

`pnpm docker:up` runs the `seed` container first. It creates the DynamoDB table,
the FIFO queue and its DLQ, and a Cognito user pool, then writes the generated
identifiers to `docker/.env.generated`, which the engine container reads.

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
