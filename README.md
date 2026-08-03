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
  in Redis so a retried message never creates a second Flow.
