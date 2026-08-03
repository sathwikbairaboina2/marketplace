# MarketplaceEngine — Design Spec

**Date:** 2026-08-03
**Status:** Approved for planning
**Scope:** MarketplaceEngine only. MarketplaceAgents and AWS deployment are separate specs.

## 1. Context

The source PRD (`prd.pdf`) describes an AI-native B2B commerce and booking platform split into two NestJS services decoupled by an AWS SQS FIFO queue:

- **MarketplaceEngine** — deterministic core. CRUD, tenant isolation, dynamic data execution.
- **MarketplaceAgents** — LangGraph.js orchestration. Conversational intent extraction, JSON blueprint generation.

That PRD is too large for one implementation cycle. It decomposes into three buildable units: the Engine, the Agents service, and the SQS contract plus Engine consumer. This spec covers the **Engine**, including its consumer side of the SQS contract. The Agents service gets its own spec.

### Goal and constraints

- Target is a **production service**, not a prototype.
- **Everything must run and be verified end to end in local Docker Compose before any real AWS deployment.** This is the acceptance bar for every feature.
- Consequence: every AWS dependency needs a working local substitute, and the application selects between local and real endpoints **by configuration only** — no code branches on environment.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| First subsystem | MarketplaceEngine | Agents have nothing to talk to without it; Engine is testable standalone |
| Runtime (this spec) | Docker Compose only | Docker-first constraint; prod topology deferred to an infra spec |
| Auth | Cognito issues, Engine verifies only | No password storage or reset flows to own; Engine holds zero auth endpoints |
| Local auth substitute | `jagregory/cognito-local` | LocalStack community does **not** include Cognito (Pro-only feature) |
| Dynamic schema | Engine owns an enforcing per-tenant registry | `attributes` must be validated regardless of which client writes it |
| Flow backfill | **None.** Registry-only | Deliberate deviation from PRD — see §8 |
| Search | Query tenant partition + `FilterExpression` | No extra infrastructure; correct results; runs in DynamoDB Local |
| Repo layout | pnpm monorepo | Shared contracts package makes Engine/Agents drift a compile error |
| Internal architecture | Per-entity modules over a shared data layer | Entity invariants need named homes; see §9 for rejected alternatives |
| Money representation | Integer minor units | Deviation from PRD — see §8 |
| Testing | TDD: unit + integration + e2e | Concurrency invariants are unprovable without real containers |

## 3. Repository layout

```
marketplace/
├─ apps/
│  ├─ engine/                  NestJS — this spec
│  └─ agents/                  placeholder; later spec
├─ packages/
│  └─ contracts/               Zod schemas + inferred types + SQS message shapes
├─ docker/
│  ├─ docker-compose.yml
│  └─ seed/                    table creation, cognito-local pool, fixtures
├─ docs/superpowers/specs/
├─ pnpm-workspace.yaml
└─ turbo.json
```

`packages/contracts` is the single source of truth for entity shapes. Zod schemas are authored there; TypeScript types are inferred from them (`z.infer`), never hand-written alongside. Engine imports it today, Agents imports the same package later.

### Local stack

| Service | Image | Port | Purpose |
|---|---|---|---|
| dynamodb-local | `amazon/dynamodb-local` | 8000 | Primary datastore |
| localstack | `localstack/localstack` | 4566 | SQS FIFO only |
| redis | `redis:7` | 6379 | Registry cache, idempotency keys |
| cognito-local | `jagregory/cognito-local` | 9229 | JWT issuance + JWKS |
| engine | `./apps/engine` | 3000 | This service |

All AWS-facing clients read `AWS_ENDPOINT_URL`; the JWT verifier reads `JWKS_URI`, `JWT_ISSUER`, `JWT_AUDIENCE`. A future production deployment omits `AWS_ENDPOINT_URL` and points `JWKS_URI` at the real Cognito pool. No code changes.

`pnpm e2e` brings the stack up, seeds the table and a Cognito-local user pool, runs the suite, and tears down.

## 4. Data model

Single DynamoDB table `MarketplaceEngine`. Every item carries `PK = TENANT#<clientId>`.

| Entity | SK |
|---|---|
| Product | `PRODUCT#<ulid>` |
| Order | `ORDER#<ulid>` |
| Event | `EVENT#<ulid>` |
| Booking | `BOOKING#<ulid>` |
| Flow | `FLOW#<ulid>` |
| Schema registry | `SCHEMA#<EntityType>` |

Identifiers are **ULIDs**, not UUIDv4 — lexicographically sortable by creation time, so `SK begins_with PRODUCT#` yields chronological ordering without a separate sort attribute.

### Secondary index

One overloaded, sparse GSI. Only items needing it project the keys.

```
GSI1PK = TENANT#<clientId>#USER#<userId>
GSI1SK = ORDER#<createdAt>#<id>   |   BOOKING#<createdAt>#<id>
```

Serves "orders for a user" and "bookings for a user". Bookings-by-event is intentionally absent: capacity is enforced by a counter on the Event, not by querying bookings.

### Hybrid schema pattern

Every record has typed core fields plus an `attributes: Record<string, unknown>` map holding dynamic, tenant-defined fields. Core fields follow the PRD's TypeScript interfaces (`ProductCore`, `OrderCore`, `EventCore`, `BookingCore`, `FlowCore`), with the money change from §8 applied.

The PRD leaves `status` untyped (`string`) on Order, Booking, and Flow. These are fixed as enums in `packages/contracts`, since untyped status fields are how invalid state transitions enter a system:

- `ProductStatus`: `active | draft | archived | out_of_stock` (as specified in the PRD)
- `OrderStatus`: `pending | confirmed | cancelled`
- `BookingStatus`: `confirmed | cancelled`
- `FlowStatus`: `proposed | applied | rejected`

v1 creates orders as `confirmed` and bookings as `confirmed`; no payment or fulfilment state machine exists yet, so `pending` and `cancelled` are reserved for a later spec rather than driven by this one.

### Schema registry record

`SK = SCHEMA#Product`:

```jsonc
{
  "version": 3,
  "fields": {
    "dietaryNeeds": { "type": "string", "required": false, "default": null }
  }
}
```

Supported field types in v1: `string`, `number`, `boolean`, `date` (ISO-8601 string), and arrays of those. **Nested objects are not supported** — nested dynamic maps complicate both validation and `FilterExpression` search, and no PRD requirement needs them.

`version` increments on every Flow execution and is the cache invalidation key. The registry is cached in Redis under `schema:<tenantId>:<entityType>` and invalidated on write, so the common path costs no extra read.

## 5. Modules

Five feature modules over three shared primitives.

**Shared primitives**

- `DynamoRepository` — the only code in the system that builds `PK` or calls `DocumentClient`. Handles key construction, pagination, and transactions.
- `SchemaRegistry` — loads, caches, and validates against per-tenant field definitions.
- `TenantContext` — `AsyncLocalStorage` store holding verified JWT claims.

**Products / Events** — create, get, list (paginated), and for products `POST /products/search`: a Query on the tenant partition with a `FilterExpression` over `attributes.<field>`. Implemented behind a `SearchProvider` interface so an OpenSearch-backed implementation can replace it without touching controllers.

**Orders — `POST /orders`.** One `TransactWriteItems` enforcing two invariants:

1. `priceMinor` is copied from the product onto each line item at write time. Later product edits never rewrite historical orders.
2. Per line item, an `Update` on the product with `ConditionExpression: stock >= :qty AND priceMinor = :expectedPrice`, alongside the order `Put`.

The price condition closes the read-then-write window: a concurrent price edit fails the transaction rather than silently charging a stale amount. The client retries against current pricing.

`TransactWriteItems` accepts at most 100 items. Line items are therefore capped at **50**, and requests exceeding that are rejected with 422 rather than failing opaquely at the AWS SDK boundary.

**Bookings — `POST /bookings`.** The Event record carries `capacity` and `bookedCount`. A two-item transaction: `Update` the event `SET bookedCount = bookedCount + :qty` with `ConditionExpression bookedCount + :qty <= capacity`, plus the booking `Put`. Overselling is structurally impossible — there is no read-then-write race because DynamoDB adjudicates the condition.

**Idempotency.** `POST /orders` and `POST /bookings` accept an `Idempotency-Key` header. Redis `SETNX` on `idem:<tenantId>:<key>`; a repeat returns the stored original response. Required, not optional: clients and load balancers retry, and neither double-charging nor double-booking is acceptable.

**Flows — audit trail and registry mutation.**

- `POST /flows` — creates a Flow record with `status: 'proposed'` carrying `blueprintDiff`.
- `POST /flows/:id/execute` — validates the diff against the current registry, applies it, bumps `version`, sets `status: 'applied'`. The registry write is conditional on the current `version`, making concurrent executions safe and the endpoint idempotent.
- **v1 accepts add-field diffs only.** Field removal and type changes are destructive migrations; combined with the no-backfill decision they would leave existing records permanently invalid against their own schema. Rejected with 422 and deferred to a migrations spec.

**SQS consumer.** Polls `marketplace-engine-jobs.fifo`. A `PROPOSE_FLOW` message creates a Flow at `status: 'proposed'` — it does **not** auto-apply. This preserves the agent's `awaiting_confirmation` semantics: a human confirms via `POST /flows/:id/execute`. Processed `messageId`s are recorded for idempotency; repeatedly failing messages go to a DLQ.

Message shape (from the PRD, typed in `packages/contracts`):

```jsonc
{
  "MessageGroupId": "TENANT#client_123",
  "MessageBody": {
    "action": "PROPOSE_FLOW",
    "targetEntity": "Event",
    "tenantId": "TENANT#client_123",
    "payload": { "addedFields": [{ "name": "dietaryNeeds", "type": "string" }] },
    "metadata": { "threadId": "thread_88291" }
  }
}
```

`MessageGroupId` is the tenant id, which serializes concurrent schema updates per tenant and prevents registry write races.

## 6. Auth and tenant isolation

A global `JwtAuthGuard` verifies RS256 signatures against a cached JWKS (refreshed on an unrecognized `kid`) and checks `iss`, `aud`, and `exp`. The Engine exposes no authentication endpoints.

**Tenant identity comes from the `custom:tenant_id` claim and from nothing else** — never from a request body, path parameter, query string, or header. This is enforced mechanically:

- The guard writes verified claims into an `AsyncLocalStorage` store. `AsyncLocalStorage` rather than a request-scoped provider, because request scoping forces Nest to re-instantiate the dependent provider subtree on every request.
- `DynamoRepository` is the only place `PK` is constructed, and it reads the tenant from that store. Its public methods accept no tenant argument.

Consequently no service *can* express a cross-tenant operation — isolation is a property of the method signatures rather than of reviewer vigilance.

A `role` claim is parsed and carried in context, but authorization beyond "authenticated member of this tenant" is deferred; the PRD defines no role distinctions.

Locally, the cognito-local pool is seeded with users carrying `custom:tenant_id` for at least two distinct tenants, which the isolation e2e test depends on.

## 7. API conventions and error handling

All routes under `/api/v1`. Request bodies validate against Zod schemas from `packages/contracts`; unknown core fields are rejected, and `attributes` validates against the tenant's registry.

List responses return `{ items, nextCursor }`, where `nextCursor` is an opaque base64 encoding of `LastEvaluatedKey`. Single resources are returned unwrapped.

Errors use RFC 9457 `application/problem+json` and include a `traceId`. `TransactionCanceledException` returns a `CancellationReasons` array positionally aligned with the submitted transaction items; the exception filter maps that index back to the originating line item so the response names *which* product was short, not merely that a transaction failed.

| Condition | Status | `type` |
|---|---|---|
| Stock condition failed | 409 | `insufficient-stock` (includes `productId`) |
| Price changed mid-order | 409 | `price-changed` (includes current price) |
| Capacity condition failed | 409 | `event-at-capacity` |
| Registry validation failed | 422 | `schema-validation-failed` (includes per-field errors) |
| Destructive Flow diff | 422 | `unsupported-schema-change` |
| Line items above 50 | 422 | `too-many-line-items` |
| Missing or invalid token | 401 | `unauthorized` |
| Item outside caller's tenant | 404 | `not-found` |

Cross-tenant access returns **404, never 403**. A 403 confirms the resource exists and leaks tenant data through the error channel.

Structured JSON logging (pino) carries `traceId` and `tenantId` on every line. `/health/live` and `/health/ready` back Docker Compose healthchecks.

## 8. Deviations from the PRD

**No Flow backfill.** The PRD states that `POST /flows/:id/execute` "triggers background backfill for historical data mapping." This design applies the registry change only; records written before the change do not receive the new field.

Consequences accepted:
- `POST /products/search` filtering on a newly added attribute will not match records created before the Flow was executed.
- API consumers must treat any dynamic attribute as possibly absent.
- Adding a `required` field does not retroactively invalidate old records, but it does mean stored records exist that would fail validation if re-submitted unchanged.

Backfill, and the field removal and type changes that depend on it, are deferred to a future migrations spec.

**Money as integer minor units.** The PRD types `price`, `unitPrice`, `totalAmount`, and `basePrice` as `number`. IEEE-754 floats cannot represent common decimal amounts exactly, and the error accumulates through order totals. Replaced with integer minor units plus an explicit currency: `priceMinor: 4999` with `currency: 'INR'`. Field names change to `priceMinor`, `unitPriceMinor`, `totalAmountMinor`, `basePriceMinor`.

Currency is stored on every money-bearing record (`Product`, `Event`, `Order`) as an ISO-4217 code, not derived from tenant configuration — an order must remain interpretable if a tenant later changes its default currency. Orders reject line items whose product currency differs from the order currency, with 422 `mixed-currency-order`; multi-currency carts are out of scope.

**Nested objects excluded from the dynamic schema.** The PRD types `attributes` as `Record<string, any>`. The registry restricts values to scalars, dates, and arrays of those.

## 9. Rejected alternatives

**Generic entity engine** — a single polymorphic service driven entirely by the registry, with entities as configuration rather than code. Rejected because the order and booking invariants cannot be expressed as configuration; they would reappear as `entityType`-switching branches inside otherwise generic code, while erasing the static types the shared contracts package exists to provide.

**Hexagonal architecture with a full domain layer** — rejected as ceremony without payoff. Swappable persistence is its main benefit, and single-table DynamoDB is load-bearing here rather than incidental. Testability, the other benefit, is already obtained from DynamoDB Local. The one port worth keeping, `SearchProvider`, is retained.

**Sparse GSIs for registry-declared indexable attributes** — deferred. DynamoDB caps a table at 20 GSIs, and indexing an existing field requires the backfill this spec declines.

**OpenSearch mirror via DynamoDB Streams** — deferred. Correct at scale, but adds a cluster to the local Docker stack and introduces eventual consistency before there is evidence the partition-scan approach is insufficient.

**Lazy defaults on read** as a backfill substitute — rejected during design in favour of no backfill at all, since materializing defaults at read time still leaves `FilterExpression` search blind to old records while adding read-path complexity.

## 10. Testing strategy

Test-driven throughout: write the failing test, then implement.

**Unit** (no I/O): key builders, cursor encoding and decoding, registry validation against field definitions, price-locking arithmetic, the add-field-only diff rule, and the `CancellationReasons` index-to-line-item mapping.

**Integration** (real containers, no mocks): repository pagination across a `LastEvaluatedKey` boundary, condition expressions rejecting as specified, registry version conditional writes, the Redis idempotency store, and the SQS consumer against a real FIFO queue. Each run creates a uniquely named table and drops it at teardown so suites can run in parallel against one Compose stack.

**End to end** (HTTP against the full stack with a real cognito-local token):

1. **Tenant isolation** — tenant B requests tenant A's product by exact id and receives 404.
2. **Oversell** — 20 concurrent bookings against `capacity: 1` produce exactly one 201 and nineteen 409s.
3. **Stock race** — concurrent orders for the last unit in stock, same assertion shape.
4. **Idempotency** — the same `Idempotency-Key` submitted twice yields one order and one stock decrement.
5. **Flow lifecycle** — `POST /flows` then `execute` bumps the registry version; a product carrying the new attribute validates, and one omitting a `required` field is rejected with 422.

There is no coverage-percentage target. The gate is that those five end-to-end invariants exist and pass.

### Build order

`packages/contracts` → shared primitives (`DynamoRepository`, `SchemaRegistry`, `TenantContext`) → feature modules → SQS consumer. Each layer's tests pass before the next begins.

## 11. Amendments during implementation

The following points in this document described the intended design at the time it was written;
the whole-branch review that preceded merge found five places where the implementation ended up
taking a different, deliberate path. Recorded here rather than silently edited into the sections
above, so the document still reflects what was decided when and why.

- **§5, Idempotency.** Redis keys are `idem:<tenantId>:<userId>:<key>`, not `idem:<tenantId>:<key>`
  as stated above. Scoping by tenant alone would let a second user in the same tenant collide on
  an `Idempotency-Key` value they didn't choose (an order id, a cart id, a retry counter) and
  receive the first user's stored response verbatim — a cross-user data leak on the replay path,
  not just a false conflict. `userId` is taken from the same ambient principal as `tenantId`.

- **§5, Bookings.** DynamoDB's `ConditionExpression` grammar has no arithmetic operators — a
  condition of the form `bookedCount + :qty <= capacity` is a `ValidationException` ("Invalid
  ConditionExpression: Syntax error; token: '+'"), even though the same arithmetic is legal in an
  `UpdateExpression`'s `SET` clause. The implementation instead precomputes the threshold from the
  `capacity` already read (`maxAllowed = capacity - ticketQuantity`) and conditions on
  `bookedCount <= :maxAllowed`, additionally pinning `capacity = :capacity` to close the
  read-then-write window on `capacity` itself. See `BookingsService.create` for the full
  reasoning.

- **§7, Cancellation-index mapping.** "The exception filter maps that index back to the
  originating line item" overstates what `ProblemFilter` does. `ProblemFilter` only translates a
  thrown exception into an HTTP response; it has no knowledge of orders, bookings, or line items.
  The mapping from a `TransactionCanceledException`'s `CancellationReasons` index back to *which*
  product or event caused it happens in each writing service's own `explainFailure` method
  (`OrdersService.explainFailure`, `BookingsService.explainFailure`), using the shared
  `failedTransactionIndexes`/`conflictedTransactionIndexes` helpers in `common/transaction-errors`.

- **§10, Integration test isolation.** Integration tests do not create a uniquely named table per
  run. There is one fixed table (`MarketplaceEngine`, or `TABLE_NAME` if set), created once by the
  `seed` container. Isolation between concurrently-running test cases comes from per-test random
  tenant ids (`t_${uniq()}`), the same mechanism the tenant-isolation guarantee itself provides.
  End-to-end tests additionally run with Jest's `--runInBand` (see `apps/engine/package.json`'s
  `test:e2e` script) so cross-suite ordering assumptions (e.g. a dedicated tenant per suite) hold.

- **§10 / §4, Registry cache invalidation.** The registry cache is not "invalidated on write."
  There is no `DEL` on the write path. `SchemaRegistryService.applyAddFields` instead writes the
  fresh record straight into the cache via a version-guarded compare-and-set
  (`setSchemaCacheIfNewer`, implemented as a single atomic Lua script): the write is applied only
  if no cached value exists yet, or the cached value's `version` is strictly less than the
  incoming one. This closes a read-after-write race that a bare invalidate would leave open — a
  concurrent `get()` whose read was in flight before the write commits could otherwise repopulate
  the cache with the stale pre-write record *after* the fresh one already landed. The
  never-called `invalidate()` method this replaced has been removed.

## 11. Out of scope

- MarketplaceAgents (LangGraph state machine, Redis checkpointer, LLM nodes)
- AWS deployment: CDK, ECS, ALB, autoscaling, secrets management
- Flow backfill and destructive schema migrations
- Role-based authorization beyond tenant membership
- Payments, shipping integration, notifications
- OpenSearch-backed search
