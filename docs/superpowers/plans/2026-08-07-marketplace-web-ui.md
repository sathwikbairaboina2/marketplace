# MarketplaceWeb Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `apps/web`, a Next.js console that exercises both services from a browser and proves that an agent conversation can add a field to a tenant's schema and have that field appear throughout the UI with no UI code written for it.

**Architecture:** One Next.js App Router application on `:3002`, added to the Docker Compose stack. Login runs through a single server-side route handler; every other call goes direct from the browser to the engine's REST API and the agents' WebSocket. Forms, filters and detail rows for tenant-defined `attributes` are generated from `GET /schemas`, so nothing hard-codes a dynamic field.

**Tech Stack:** Next.js (App Router) · React 19 · ANTD v5 · TypeScript · Zod (via `@marketplace/contracts`) · socket.io-client 4.8 · Vitest + Testing Library (unit) · Playwright (e2e) · pnpm workspaces + Turbo.

**Spec:** `docs/superpowers/specs/2026-08-07-marketplace-web-ui-design.md`

## Global Constraints

- Node `>=22`, pnpm `9.12.0`. New packages join the workspace via the existing `apps/*` glob in `pnpm-workspace.yaml` — no workspace config change is needed.
- `socket.io-client` must be `^4.8.0` to match `socket.io` `^4.8.0` in `apps/agents/package.json`.
- ANTD v5 on React 19 requires **both** `@ant-design/nextjs-registry` (SSR style extraction) and `@ant-design/v5-patch-for-react-19` (React 19 compatibility for `message`, `notification`, `Modal`).
- `NEXT_PUBLIC_*` values are inlined at `next build` time. They are set as `ENV` in `apps/web/Dockerfile` **before** the build step. Setting them in `docker-compose.yml` has no effect — anything needed at runtime must come from a route handler instead.
- Backend runtime changes default to off: `CORS_ORIGINS` defaults to `''`, matching the `DOCS_ENABLED` pattern in `apps/engine/src/config/env.schema.ts`.
- Any new engine `*.int-test.ts` **must** copy the Redis teardown from `apps/engine/src/docs/openapi-document.int-test.ts` verbatim — wait for `ready`, then `redis.quit()`, then `app.close()`. Skipping the ready-wait reintroduces a 2000ms ioredis reconnect timer and Jest's "worker process failed to exit gracefully".
- Role is **not** authorization. The engine enforces tenant isolation on every route and enforces nothing about role. No task may present role as a security boundary.
- Flows are add-only: `actionType` is the literal `'ADD_FIELDS'` and `BlueprintDiffSchema` is `.strict()` around `addedFields`. Build no removal or type-change affordance.
- The dev password constant is `Passw0rd!`, matching `apps/engine/test/e2e/helpers/auth.ts`.
- Commit after every task. No Claude co-author trailer.

---

### Task 1: Response schemas in `@marketplace/contracts`

The engine's response shapes are hand-written TypeScript interfaces with no runtime schema. The web client needs something to validate against, and writing a second set inside `apps/web` would create drift. Add them once, in contracts.

**Files:**
- Create: `packages/contracts/src/responses.ts`
- Create: `packages/contracts/src/responses.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `pageOf(item)`, `ProductResponseSchema`, `EventResponseSchema`, `OrderResponseSchema`, `BookingResponseSchema`, `FlowResponseSchema`, `PrincipalSchema`, `SchemaViewSchema`, `SchemaListSchema`, and the inferred types `ProductResponse`, `EventResponse`, `OrderResponse`, `BookingResponse`, `FlowResponse`, `Principal`, `SchemaView`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contracts/src/responses.test.ts
import {
  pageOf,
  ProductResponseSchema,
  FlowResponseSchema,
  PrincipalSchema,
  SchemaViewSchema,
} from './responses';

const product = {
  entityType: 'Product' as const,
  id: '01J0000000000000000000000A',
  status: 'active' as const,
  name: 'Widget',
  description: 'A widget',
  priceMinor: 1500,
  currency: 'USD',
  category: 'tools',
  stock: 10,
  images: [],
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  attributes: { colour: 'red' },
};

describe('response schemas', () => {
  it('accepts a product response and rejects one missing priceMinor', () => {
    expect(ProductResponseSchema.parse(product)).toMatchObject({ name: 'Widget' });
    const { priceMinor, ...withoutPrice } = product;
    expect(ProductResponseSchema.safeParse(withoutPrice).success).toBe(false);
  });

  it('rejects a product response carrying the DynamoDB keys', () => {
    expect(ProductResponseSchema.safeParse({ ...product, PK: 'TENANT#a' }).success).toBe(false);
  });

  it('wraps items and a nullable cursor', () => {
    const page = pageOf(ProductResponseSchema);
    expect(page.parse({ items: [product], nextCursor: null }).items).toHaveLength(1);
    expect(page.safeParse({ items: [product] }).success).toBe(false);
  });

  it('accepts a schema view', () => {
    expect(
      SchemaViewSchema.parse({
        entityType: 'Product',
        version: 2,
        fields: { colour: { type: 'string', required: false, default: null } },
      }).version,
    ).toBe(2);
  });

  it('accepts a flow response with a null executedBy', () => {
    expect(
      FlowResponseSchema.parse({
        id: '01J0000000000000000000000B',
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        status: 'proposed',
        blueprintDiff: { addedFields: [{ name: 'colour', type: 'string', required: false, default: null }] },
        createdAt: '2026-08-07T00:00:00.000Z',
        proposedBy: 'user-1',
        executedBy: null,
        appliedAt: null,
        resultingVersion: null,
      }).status,
    ).toBe('proposed');
  });

  it('accepts a principal with a null role', () => {
    expect(PrincipalSchema.parse({ tenantId: 'acme', userId: 'u1', role: null }).role).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/contracts test -- responses`
Expected: FAIL — `Cannot find module './responses'`.

- [ ] **Step 3: Write the implementation**

`ProductResponse` in the engine is `Omit<ProductRecord, 'PK' | 'SK'>`, so these schemas use `.strict()` to reject the key attributes if they ever leak.

```ts
// packages/contracts/src/responses.ts
import { z } from 'zod';
import { AttributesSchema, CurrencySchema, IsoDateTimeSchema, UlidSchema } from './common';
import { ProductStatusSchema } from './product';
import { OrderStatusSchema } from './order';
import { BookingStatusSchema } from './booking';
import { BlueprintDiffSchema, FlowStatusSchema } from './flow';
import { DynamicEntityTypeSchema, FieldDefinitionSchema, FieldNameSchema } from './registry';

/** `{ items, nextCursor }` — the shape every list endpoint returns. */
export const pageOf = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const ProductResponseSchema = z
  .object({
    entityType: z.literal('Product'),
    id: UlidSchema,
    status: ProductStatusSchema,
    name: z.string(),
    description: z.string(),
    priceMinor: z.number().int(),
    currency: CurrencySchema,
    category: z.string(),
    stock: z.number().int(),
    images: z.array(z.string()),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type ProductResponse = z.infer<typeof ProductResponseSchema>;

export const EventResponseSchema = z
  .object({
    entityType: z.literal('Event'),
    id: UlidSchema,
    title: z.string(),
    capacity: z.number().int(),
    booked: z.number().int(),
    startDate: IsoDateTimeSchema,
    endDate: IsoDateTimeSchema,
    basePriceMinor: z.number().int(),
    currency: CurrencySchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type EventResponse = z.infer<typeof EventResponseSchema>;

export const OrderLineItemSchema = z
  .object({
    productId: UlidSchema,
    quantity: z.number().int(),
    unitPriceMinor: z.number().int(),
  })
  .strict();

export const OrderResponseSchema = z
  .object({
    entityType: z.literal('Order'),
    id: UlidSchema,
    userId: z.string(),
    status: OrderStatusSchema,
    totalAmountMinor: z.number().int(),
    currency: CurrencySchema,
    items: z.array(OrderLineItemSchema),
    shippingAddress: z.record(z.string(), z.string()),
    createdAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type OrderResponse = z.infer<typeof OrderResponseSchema>;

export const BookingResponseSchema = z
  .object({
    entityType: z.literal('Booking'),
    id: UlidSchema,
    eventId: UlidSchema,
    userId: z.string(),
    status: BookingStatusSchema,
    ticketQuantity: z.number().int(),
    createdAt: IsoDateTimeSchema,
    attributes: AttributesSchema,
  })
  .strict();
export type BookingResponse = z.infer<typeof BookingResponseSchema>;

export const FlowResponseSchema = z
  .object({
    id: UlidSchema,
    targetEntity: DynamicEntityTypeSchema,
    actionType: z.literal('ADD_FIELDS'),
    status: FlowStatusSchema,
    blueprintDiff: BlueprintDiffSchema,
    createdAt: IsoDateTimeSchema,
    proposedBy: z.string(),
    executedBy: z.string().nullable(),
    appliedAt: IsoDateTimeSchema.nullable(),
    resultingVersion: z.number().int().nullable(),
  })
  .strict();
export type FlowResponse = z.infer<typeof FlowResponseSchema>;

/** What `GET /me` returns — mirrors `TenantPrincipal` in `@marketplace/auth`. */
export const PrincipalSchema = z
  .object({ tenantId: z.string(), userId: z.string(), role: z.string().nullable() })
  .strict();
export type Principal = z.infer<typeof PrincipalSchema>;

export const SchemaViewSchema = z
  .object({
    entityType: DynamicEntityTypeSchema,
    version: z.number().int().nonnegative(),
    fields: z.record(FieldNameSchema, FieldDefinitionSchema),
  })
  .strict();
export type SchemaView = z.infer<typeof SchemaViewSchema>;

export const SchemaListSchema = z.object({ items: z.array(SchemaViewSchema) }).strict();
```

Then export it:

```ts
// packages/contracts/src/index.ts — add alongside the existing exports
export * from './responses';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/contracts test -- responses`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the real shapes match by checking against the engine's interfaces**

Read `apps/engine/src/products/products.service.ts`, `events.service.ts`, `orders.service.ts`, `bookings.service.ts` and `flows.service.ts` and confirm each `*Response` type's fields match the schema above field-for-field. `EventResponse` in particular: confirm whether it exposes `booked` and `updatedAt`. If any field differs, fix the schema — the engine is the source of truth here, not this plan.

- [ ] **Step 6: Point the engine's response types at the schemas**

In each service, replace the hand-written interface with an alias so the two can never drift:

```ts
// apps/engine/src/products/products.service.ts — replace the interface declaration
import type { ProductResponse } from '@marketplace/contracts';
export type { ProductResponse };
```

Repeat for events, orders, bookings and flows. Do **not** change any runtime code — only the type declarations.

- [ ] **Step 7: Verify nothing broke**

Run: `pnpm --filter @marketplace/contracts build && pnpm --filter @marketplace/engine build && pnpm --filter @marketplace/engine test`
Expected: builds clean, all engine unit and integration tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/responses.ts packages/contracts/src/responses.test.ts packages/contracts/src/index.ts apps/engine/src
git commit -m "feat(contracts): add response schemas and alias the engine's response types to them"
```

---

### Task 2: Engine CORS, off by default

**Files:**
- Modify: `apps/engine/src/config/env.schema.ts`
- Modify: `apps/engine/src/app.factory.ts`
- Create: `apps/engine/src/common/cors.int-test.ts`
- Modify: `docker/docker-compose.yml` (engine service `environment` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `EnvConfig['CORS_ORIGINS']` (a `string`, comma-separated, `''` when disabled).

- [ ] **Step 1: Write the failing test**

Note the `afterAll` — it is the hard-won Redis teardown from `openapi-document.int-test.ts` and must not be simplified.

```ts
// apps/engine/src/common/cors.int-test.ts
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

describe('CORS', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'http://localhost:3002';
    process.env.SQS_CONSUMER_ENABLED = 'false';
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // See openapi-document.int-test.ts: RedisModule's client has no
    // onModuleDestroy, and quitting before `ready` makes ioredis schedule a
    // 2000ms reconnect timer that outlives the suite.
    const redis = app.get<Redis>(REDIS);
    if (redis.status !== 'ready') {
      await new Promise((resolve) => redis.once('ready', resolve));
    }
    await redis.quit();
    await app.close();
    delete process.env.CORS_ORIGINS;
  });

  it('allows the configured origin and the headers the client sends', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3002',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,idempotency-key',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3002');
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    expect(allowed).toContain('authorization');
    expect(allowed).toContain('idempotency-key');
  });

  it('does not allow an unconfigured origin', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.headers.get('access-control-allow-origin')).not.toBe('http://evil.example');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/engine test -- cors`
Expected: FAIL — `access-control-allow-origin` is `null` because nothing enables CORS.

Requires Redis on `localhost:6379`. If it is not running: `docker compose -f docker/docker-compose.yml up -d redis`.

- [ ] **Step 3: Add the env field**

```ts
// apps/engine/src/config/env.schema.ts — add inside EnvSchema, after DOCS_ENABLED
  // Comma-separated allowed origins for the browser client. Empty means CORS
  // stays off entirely, so a deployed build behaves exactly as before this
  // existed -- same posture as DOCS_ENABLED.
  CORS_ORIGINS: z.string().default(''),
```

- [ ] **Step 4: Enable it in the factory**

```ts
// apps/engine/src/app.factory.ts — add after the DOCS_ENABLED block, before `return app`
  if (env.CORS_ORIGINS) {
    app.enableCors({
      origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
      // Listed explicitly rather than reflected: `Idempotency-Key` is required
      // on POST /orders and POST /bookings, and a preflight that silently drops
      // it turns every order into an opaque browser-side CORS failure.
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
      methods: ['GET', 'POST', 'OPTIONS'],
    });
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- cors`
Expected: PASS, 2 tests.

- [ ] **Step 6: Allow the web origin in Compose**

```yaml
# docker/docker-compose.yml — in the `engine` service's `environment:` block,
# next to DOCS_ENABLED
      CORS_ORIGINS: http://localhost:3002
```

- [ ] **Step 7: Run the full engine suite**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS with no "worker process has failed to exit gracefully" warning. If that warning appears, the `afterAll` above was altered — restore it.

- [ ] **Step 8: Commit**

```bash
git add apps/engine/src/config/env.schema.ts apps/engine/src/app.factory.ts apps/engine/src/common/cors.int-test.ts docker/docker-compose.yml
git commit -m "feat(engine): enable CORS when CORS_ORIGINS is set"
```

---

### Task 3: Seed demo users with tenants and roles

Three personas across two tenants, so tenant isolation can be demonstrated in the UI rather than only asserted in a test.

No migration step is needed: `scripts/docker-teardown.mjs` already runs `docker volume rm -f marketplace_cognito-data` on every `pnpm docker:down`, so the pool is recreated with the new attribute schema on the next `docker:up`.

**Files:**
- Modify: `docker/seed/cognito.ts`
- Modify: `docker/seed/seed.ts`
- Modify: `docker/seed/verify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DEMO_USERS` (an array of `{ username, tenantId, role }`), `DEMO_PASSWORD` (the string `'Passw0rd!'`), and `ensureDemoUsers(userPoolId: string): Promise<void>`, all exported from `docker/seed/cognito.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// docker/seed/verify.test.ts — add to the existing describe block
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DEMO_USERS, DEMO_PASSWORD } from './cognito';

it('can authenticate every demo user and each token carries its tenant and role', async () => {
  const client = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  for (const user of DEMO_USERS) {
    const res = await client.send(
      new InitiateAuthCommand({
        ClientId: process.env.COGNITO_CLIENT_ID!,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: user.username, PASSWORD: DEMO_PASSWORD },
      }),
    );

    const idToken = res.AuthenticationResult!.IdToken!;
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString('utf8'));
    expect(claims['custom:tenant_id']).toBe(user.tenantId);
    expect(claims['custom:role']).toBe(user.role);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm docker:up && pnpm --filter seed test`
Expected: FAIL — `UserNotFoundException`, because no users are seeded.

Check `docker/seed/package.json` for the exact package name and test script; use whatever filter it declares.

- [ ] **Step 3: Add the role attribute and the demo users**

```ts
// docker/seed/cognito.ts
import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const POOL_NAME = 'marketplace';
const CLIENT_NAME = 'marketplace-engine';

/**
 * Two tenants on purpose. `globex-admin` exists so tenant isolation is
 * something a person can see by switching personas, not only something an
 * e2e assertion claims.
 */
export const DEMO_USERS = [
  { username: 'acme-admin', tenantId: 'acme', role: 'admin' },
  { username: 'acme-buyer', tenantId: 'acme', role: 'buyer' },
  { username: 'globex-admin', tenantId: 'globex', role: 'admin' },
] as const;

/** Matches apps/engine/test/e2e/helpers/auth.ts so there is one dev password. */
export const DEMO_PASSWORD = 'Passw0rd!';

export async function ensureDemoUsers(userPoolId: string): Promise<void> {
  const cognito = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  for (const user of DEMO_USERS) {
    const attributes = [
      { Name: 'custom:tenant_id', Value: user.tenantId },
      { Name: 'custom:role', Value: user.role },
    ];

    try {
      await cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          MessageAction: 'SUPPRESS',
          UserAttributes: attributes,
        }),
      );
    } catch (err) {
      if ((err as Error).name !== 'UsernameExistsException') throw err;

      // Force the attributes rather than trusting whatever survived: a user
      // left over with the wrong tenant would hand out a token for the wrong
      // tenant with no error, which is exactly what the isolation demo must
      // not be able to fake.
      await cognito.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          UserAttributes: attributes,
        }),
      );
    }

    await cognito.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        Password: DEMO_PASSWORD,
        Permanent: true,
      }),
    );
  }
}
```

In the same file, add `role` to the pool's declared schema:

```ts
// docker/seed/cognito.ts — inside CreateUserPoolCommand
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        Schema: [
          { Name: 'tenant_id', AttributeDataType: 'String', Mutable: true },
          { Name: 'role', AttributeDataType: 'String', Mutable: true },
        ],
      }),
```

- [ ] **Step 4: Call it from the seed entrypoint**

```ts
// docker/seed/seed.ts — after the existing ensureUserPool call
  const { userPoolId, clientId } = await ensureUserPool();
  await ensureDemoUsers(userPoolId);
```

Add `ensureDemoUsers` to the import from `./cognito`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm docker:down && pnpm docker:up && pnpm --filter seed test`
Expected: PASS. The `docker:down` matters — it drops `marketplace_cognito-data` so the pool is rebuilt with the `role` attribute.

If `AdminCreateUser` rejects `custom:role` even after the volume drop, cognito-local is enforcing the pool schema and the pool was not actually recreated; confirm the volume is gone with `docker volume ls | grep cognito`.

- [ ] **Step 6: Commit**

```bash
git add docker/seed
git commit -m "feat(seed): create demo users across two tenants with roles"
```

---

### Task 4: Scaffold `apps/web`

Deliverable: a page that renders in Docker, a health route, and a passing unit test. No product features yet.

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.mjs`, `apps/web/vitest.config.ts`, `apps/web/Dockerfile`, `apps/web/.dockerignore`
- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/api/health/route.ts`
- Create: `apps/web/lib/env.ts`, `apps/web/lib/env.test.ts`
- Modify: `docker/docker-compose.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: `ENGINE_URL` and `AGENTS_URL` string constants exported from `apps/web/lib/env.ts`.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@marketplace/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@ant-design/nextjs-registry": "^1.0.2",
    "@ant-design/v5-patch-for-react-19": "^1.0.3",
    "@aws-sdk/client-cognito-identity-provider": "^3.665.0",
    "@marketplace/contracts": "workspace:*",
    "antd": "^5.22.0",
    "dayjs": "^1.11.13",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "socket.io-client": "^4.8.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/node": "^22.7.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/web/lib/env.test.ts
import { describe, expect, it } from 'vitest';
import { ENGINE_URL, AGENTS_URL } from './env';

describe('env', () => {
  it('exposes absolute base URLs with no trailing slash', () => {
    for (const url of [ENGINE_URL, AGENTS_URL]) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url.endsWith('/')).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm install && pnpm --filter @marketplace/web test`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 4: Write the config, env module and shell**

```ts
// apps/web/lib/env.ts
/**
 * These are read in the browser, so they must point at host-facing ports --
 * compose service names do not resolve there. They are inlined at `next build`
 * time (see apps/web/Dockerfile), which is why nothing that changes per-run
 * belongs here; runtime values come from route handlers instead.
 */
const strip = (url: string) => url.replace(/\/+$/, '');

export const ENGINE_URL = strip(process.env.NEXT_PUBLIC_ENGINE_URL ?? 'http://localhost:3000/api/v1');
export const AGENTS_URL = strip(process.env.NEXT_PUBLIC_AGENTS_URL ?? 'http://localhost:3001');
```

```ts
// apps/web/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    // Playwright specs live in test/e2e and must not be collected by Vitest.
    exclude: ['node_modules/**', 'test/e2e/**', '.next/**'],
  },
});
```

```ts
// apps/web/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
```

```js
// apps/web/next.config.mjs
/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The workspace packages ship TypeScript sources consumed directly.
  transpilePackages: ['@marketplace/contracts'],
};
```

```json
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", "test/e2e"]
}
```

```tsx
// apps/web/app/layout.tsx
import { AntdRegistry } from '@ant-design/nextjs-registry';
// ANTD v5 targets React 18's rendering entry points. Next.js ships React 19,
// and without this patch `message`, `notification` and `Modal` -- the whole
// error surface of this app -- log compatibility errors and can fail to mount.
import '@ant-design/v5-patch-for-react-19';

export const metadata = { title: 'Marketplace' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>{children}</AntdRegistry>
      </body>
    </html>
  );
}
```

```tsx
// apps/web/app/page.tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/products');
}
```

```ts
// apps/web/app/api/health/route.ts
// Compose healthcheck target. Deliberately does not touch the engine: this
// reports whether the web server is up, not whether the platform is.
export function GET() {
  return Response.json({ status: 'ok' });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test`
Expected: PASS, 1 test.

- [ ] **Step 6: Write the Dockerfile**

`NEXT_PUBLIC_*` must be set before `next build`, not in Compose.

```dockerfile
# apps/web/Dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle by `next build`. Setting
# them in docker-compose.yml would have no effect on the browser bundle, so
# they are baked here. They point at host-facing ports because the code that
# reads them runs in the browser, not in this container.
ENV NEXT_PUBLIC_ENGINE_URL=http://localhost:3000/api/v1
ENV NEXT_PUBLIC_AGENTS_URL=http://localhost:3001
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @marketplace/contracts build \
 && pnpm --filter @marketplace/web build
WORKDIR /repo/apps/web
CMD ["pnpm", "start"]
```

- [ ] **Step 7: Add the Compose service**

```yaml
# docker/docker-compose.yml — after the `agents` service
  web:
    build: { context: .., dockerfile: apps/web/Dockerfile }
    ports: ['3002:3002']
    # Same rationale as `engine`: .env.generated is written by `seed` during
    # this same `up`, and supplies COGNITO_CLIENT_ID for the login handler.
    env_file: [{ path: ./.env.generated, required: false }]
    environment:
      # Read at request time by route handlers running IN this container --
      # unlike NEXT_PUBLIC_*, which are baked at build time in the Dockerfile.
      COGNITO_ENDPOINT: http://cognito-local:9229
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
      DEV_PERSONAS: acme-admin,acme-buyer,globex-admin
      DEV_PASSWORD: Passw0rd!
    depends_on:
      engine: { condition: service_healthy }
      agents: { condition: service_healthy }
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3002/api/health || exit 1']
      interval: 3s
      retries: 30
```

Then add `web` to the second `docker compose up` invocation in the root `package.json`'s `docker:up` script, alongside `engine agents`.

- [ ] **Step 8: Verify it runs in Docker**

Run: `pnpm docker:down && pnpm docker:up`
Then: `curl -s http://localhost:3002/api/health`
Expected: `{"status":"ok"}`, and `docker compose -f docker/docker-compose.yml ps` shows `web` healthy.

- [ ] **Step 9: Commit**

```bash
git add apps/web docker/docker-compose.yml package.json pnpm-lock.yaml
git commit -m "feat(web): scaffold the Next.js console and add it to the compose stack"
```

---

### Task 5: Login route handler, personas route, and auth context

**Files:**
- Create: `apps/web/app/api/login/route.ts`, `apps/web/app/api/personas/route.ts`
- Create: `apps/web/lib/auth/auth-context.tsx`, `apps/web/lib/auth/auth-context.test.tsx`
- Create: `apps/web/app/login/page.tsx`

**Interfaces:**
- Consumes: `ENGINE_URL` (Task 4); `PrincipalSchema`, `Principal` (Task 1).
- Produces: `AuthProvider`, `useAuth(): { token: string | null; principal: Principal | null; signIn(username: string, password: string): Promise<void>; signOut(): void; ready: boolean }`, and `getToken(): string | null` — a module-level accessor the API client reads without needing React context.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/lib/auth/auth-context.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AuthProvider, useAuth, getToken } from './auth-context';

function Probe() {
  const { principal, signIn, ready } = useAuth();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="tenant">{principal?.tenantId ?? 'none'}</span>
      <button onClick={() => signIn('acme-admin', 'Passw0rd!')}>in</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('stores the token and principal after a successful sign in', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith('/api/login')) {
          return new Response(JSON.stringify({ token: 'tok-123' }), { status: 200 });
        }
        return new Response(
          JSON.stringify({ tenantId: 'acme', userId: 'acme-admin', role: 'admin' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {
      screen.getByText('in').click();
    });

    expect(screen.getByTestId('tenant')).toHaveTextContent('acme');
    expect(sessionStorage.getItem('marketplace.token')).toBe('tok-123');
    expect(getToken()).toBe('tok-123');
  });

  it('rehydrates a token from sessionStorage on mount', async () => {
    sessionStorage.setItem('marketplace.token', 'tok-existing');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ tenantId: 'globex', userId: 'g', role: 'admin' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await act(async () => {});
    expect(screen.getByTestId('tenant')).toHaveTextContent('globex');
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- auth-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the auth context**

```tsx
// apps/web/lib/auth/auth-context.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { PrincipalSchema, type Principal } from '@marketplace/contracts';
import { ENGINE_URL } from '../env';

const STORAGE_KEY = 'marketplace.token';

// A module-level mirror of the token. lib/api/http.ts runs outside React and
// needs the bearer on every call; threading it through props or reading a hook
// from a non-component would be worse than one small module-scoped cell that
// the provider is the sole writer of.
let currentToken: string | null = null;
export const getToken = (): string | null => currentToken;

interface AuthValue {
  token: string | null;
  principal: Principal | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [ready, setReady] = useState(false);

  const adopt = useCallback(async (next: string) => {
    currentToken = next;
    const res = await fetch(`${ENGINE_URL}/me`, { headers: { Authorization: `Bearer ${next}` } });
    if (!res.ok) throw new Error('token rejected');
    const me = PrincipalSchema.parse(await res.json());
    sessionStorage.setItem(STORAGE_KEY, next);
    setToken(next);
    setPrincipal(me);
  }, []);

  const signOut = useCallback(() => {
    currentToken = null;
    sessionStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setPrincipal(null);
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setReady(true);
      return;
    }
    // A stored token can be expired or minted against a pool that has since
    // been recreated by `docker:up`. Validating here means a stale session
    // lands on /login instead of failing on the first data call.
    adopt(stored)
      .catch(() => signOut())
      .finally(() => setReady(true));
  }, [adopt, signOut]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? 'sign in failed');
      }
      const { token: next } = (await res.json()) as { token: string };
      await adopt(next);
    },
    [adopt],
  );

  return (
    <AuthContext.Provider value={{ token, principal, ready, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- auth-context`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the login route handler**

This runs inside the container. cognito-local stamps `iss` from its own configured issuer domain (default `http://localhost:9229`), **not** from the request's Host header — which is why a token minted here over the internal `cognito-local:9229` endpoint still satisfies the engine's `JWT_ISSUER` of `http://localhost:9229/<poolId>`. The dev-token endpoint already relies on this.

```ts
// apps/web/app/api/login/route.ts
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export async function POST(request: Request) {
  const { username, password } = (await request.json()) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return Response.json({ detail: 'username and password are required' }, { status: 400 });
  }

  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!clientId || !process.env.COGNITO_ENDPOINT) {
    return Response.json({ detail: 'auth is not configured' }, { status: 503 });
  }

  const cognito = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.COGNITO_ENDPOINT,
  });

  try {
    const res = await cognito.send(
      new InitiateAuthCommand({
        ClientId: clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: username, PASSWORD: password },
      }),
    );
    const token = res.AuthenticationResult?.IdToken;
    if (!token) return Response.json({ detail: 'no id token returned' }, { status: 502 });
    return Response.json({ token });
  } catch {
    // Deliberately not echoing the Cognito error: "user not found" and "wrong
    // password" are the same answer to a client.
    return Response.json({ detail: 'invalid credentials' }, { status: 401 });
  }
}
```

- [ ] **Step 6: Write the personas route handler**

```ts
// apps/web/app/api/personas/route.ts
// Read at request time, not baked into the bundle: the persona list and the
// dev password originate from the seed's environment, and a NEXT_PUBLIC_*
// variable would freeze whatever was present at `next build`.
export function GET() {
  const usernames = (process.env.DEV_PERSONAS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const password = process.env.DEV_PASSWORD ?? '';

  if (!usernames.length || !password) return Response.json({ personas: [] });
  return Response.json({ personas: usernames.map((username) => ({ username, password })) });
}
```

- [ ] **Step 7: Write the login page**

```tsx
// apps/web/app/login/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Select } from 'antd';
import { useAuth } from '../../lib/auth/auth-context';

interface Persona {
  username: string;
  password: string;
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [form] = Form.useForm();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((body: { personas: Persona[] }) => setPersonas(body.personas))
      .catch(() => setPersonas([]));
  }, []);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(values.username, values.password);
      router.push('/products');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Sign in" style={{ maxWidth: 420, margin: '64px auto' }}>
      {personas.length > 0 && (
        <Select
          data-testid="persona"
          style={{ width: '100%', marginBottom: 16 }}
          placeholder="Pick a demo persona"
          options={personas.map((p) => ({ value: p.username, label: p.username }))}
          onChange={(username) => {
            const persona = personas.find((p) => p.username === username)!;
            form.setFieldsValue(persona);
          }}
        />
      )}
      {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
      <Form form={form} layout="vertical" onFinish={submit}>
        <Form.Item name="username" label="Username" rules={[{ required: true }]}>
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy} block>
          Sign in
        </Button>
      </Form>
    </Card>
  );
}
```

Wrap the app in `AuthProvider` by adding it to `app/layout.tsx` inside `<AntdRegistry>`.

- [ ] **Step 8: Verify login works against the live stack**

Run: `pnpm docker:down && pnpm docker:up`
Then in a browser open `http://localhost:3002/login`, pick `acme-admin`, sign in.
Expected: no error, and `sessionStorage.getItem('marketplace.token')` is set in devtools.

Also confirm the CLI path:
```bash
curl -s -X POST http://localhost:3002/api/login -H 'Content-Type: application/json' \
  -d '{"username":"acme-admin","password":"Passw0rd!"}'
```
Expected: a JSON body with a `token`.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): sign in through a server-side Cognito route handler"
```

---

### Task 6: The API client

**Files:**
- Create: `apps/web/lib/api/http.ts`, `apps/web/lib/api/http.test.ts`
- Create: `apps/web/lib/api/products.ts`, `events.ts`, `orders.ts`, `bookings.ts`, `flows.ts`, `schemas.ts`, `me.ts`

**Interfaces:**
- Consumes: `getToken` (Task 5); `ENGINE_URL` (Task 4); every response schema (Task 1).
- Produces:
  - `request<T>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; schema: z.ZodType<T>; idempotencyKey?: string }): Promise<T>`
  - `class ProblemError extends Error` with `type`, `status`, `title`, `detail`, `traceId`, `errors`
  - `class ContractMismatchError extends Error` with `issues`
  - `onUnauthorized(handler: () => void): void`
  - Resource functions: `listProducts`, `searchProducts`, `getProduct`, `createProduct`, `listEvents`, `getEvent`, `createEvent`, `createOrder`, `listOrders`, `getOrder`, `createBooking`, `listBookings`, `getBooking`, `listFlows`, `getFlow`, `createFlow`, `executeFlow`, `listSchemas`, `getMe`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/api/http.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { request, ProblemError, ContractMismatchError, onUnauthorized } from './http';

const Schema = z.object({ id: z.string() }).strict();

const jsonResponse = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });

describe('request', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: 'a' })));
    await expect(request('/things/a', { schema: Schema })).resolves.toEqual({ id: 'a' });
  });

  it('sends the idempotency key only when given one', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'a' }));
    vi.stubGlobal('fetch', fetchMock);

    await request('/things', { method: 'POST', body: {}, schema: Schema, idempotencyKey: 'k-1' });
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get('Idempotency-Key')).toBe('k-1');

    await request('/things', { method: 'POST', body: {}, schema: Schema });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).has('Idempotency-Key')).toBe(false);
  });

  it('throws ProblemError carrying the traceId and errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(
          {
            type: 'validation-failed',
            title: 'Invalid request',
            status: 400,
            detail: 'name is required',
            traceId: 'trace-9',
            errors: [{ path: 'name', message: 'Required' }],
          },
          400,
          'application/problem+json',
        ),
      ),
    );

    const err = await request('/things', { schema: Schema }).catch((e) => e);
    expect(err).toBeInstanceOf(ProblemError);
    expect(err.status).toBe(400);
    expect(err.traceId).toBe('trace-9');
    expect(err.errors).toHaveLength(1);
  });

  it('throws ContractMismatchError when the body does not match the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ wrong: true })));
    await expect(request('/things/a', { schema: Schema })).rejects.toBeInstanceOf(
      ContractMismatchError,
    );
  });

  it('notifies the unauthorized handler on a 401', async () => {
    const handler = vi.fn();
    onUnauthorized(handler);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ type: 'unauthorized', title: 'Unauthorized', status: 401 }, 401, 'application/problem+json'),
      ),
    );

    await request('/things/a', { schema: Schema }).catch(() => {});
    expect(handler).toHaveBeenCalledOnce();
  });

  it('serialises query parameters and drops undefined ones', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'a' }));
    vi.stubGlobal('fetch', fetchMock);
    await request('/things', { query: { limit: 25, cursor: undefined }, schema: Schema });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/things\?limit=25$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- http`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the client**

```ts
// apps/web/lib/api/http.ts
import { z } from 'zod';
import { ENGINE_URL } from '../env';
import { getToken } from '../auth/auth-context';

export interface ProblemField {
  path: string;
  message: string;
}

/** An RFC 9457 problem document, as written by both services' ProblemFilter. */
export class ProblemError extends Error {
  constructor(
    readonly type: string,
    readonly status: number,
    readonly title: string,
    readonly detail: string | undefined,
    readonly traceId: string | undefined,
    readonly errors: ProblemField[],
  ) {
    super(detail ? `${title}: ${detail}` : title);
    this.name = 'ProblemError';
  }
}

/**
 * The request succeeded but the body failed its schema. Not a user error: it
 * means this client and the service disagree about @marketplace/contracts, so
 * it is surfaced persistently rather than as a dismissable toast.
 */
export class ContractMismatchError extends Error {
  constructor(
    readonly path: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(`Response from ${path} did not match its contract`);
    this.name = 'ContractMismatchError';
  }
}

let unauthorizedHandler: () => void = () => {};
export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export interface RequestOptions<T> {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: z.ZodType<T>;
  idempotencyKey?: string;
}

export async function request<T>(path: string, opts: RequestOptions<T>): Promise<T> {
  const url = new URL(`${ENGINE_URL}${path}`);
  for (const [key, value] of Object.entries(opts.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (opts.body !== undefined) headers.set('Content-Type', 'application/json');
  if (opts.idempotencyKey) headers.set('Idempotency-Key', opts.idempotencyKey);

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler();
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    throw new ProblemError(
      typeof body.type === 'string' ? body.type : 'about:blank',
      res.status,
      typeof body.title === 'string' ? body.title : res.statusText,
      typeof body.detail === 'string' ? body.detail : undefined,
      typeof body.traceId === 'string' ? body.traceId : undefined,
      Array.isArray(body.errors) ? (body.errors as ProblemField[]) : [],
    );
  }

  const parsed = opts.schema.safeParse(await res.json());
  if (!parsed.success) throw new ContractMismatchError(path, parsed.error.issues);
  return parsed.data;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- http`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the resource modules**

```ts
// apps/web/lib/api/products.ts
import {
  CreateProduct,
  ProductResponseSchema,
  SearchProducts,
  pageOf,
  type ProductResponse,
} from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(ProductResponseSchema);

export const listProducts = (limit: number, cursor: string | null) =>
  request('/products', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const searchProducts = (body: SearchProducts) =>
  request('/products/search', { method: 'POST', body, schema: Page });

export const getProduct = (id: string) =>
  request(`/products/${id}`, { schema: ProductResponseSchema });

export const createProduct = (body: CreateProduct): Promise<ProductResponse> =>
  request('/products', { method: 'POST', body, schema: ProductResponseSchema });
```

```ts
// apps/web/lib/api/orders.ts
import { CreateOrder, OrderResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(OrderResponseSchema);

export const createOrder = (body: CreateOrder, idempotencyKey: string) =>
  request('/orders', { method: 'POST', body, schema: OrderResponseSchema, idempotencyKey });

export const listOrders = (limit: number, cursor: string | null) =>
  request('/orders', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getOrder = (id: string) => request(`/orders/${id}`, { schema: OrderResponseSchema });
```

```ts
// apps/web/lib/api/bookings.ts
import { CreateBooking, BookingResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(BookingResponseSchema);

export const createBooking = (body: CreateBooking, idempotencyKey: string) =>
  request('/bookings', { method: 'POST', body, schema: BookingResponseSchema, idempotencyKey });

export const listBookings = (limit: number, cursor: string | null) =>
  request('/bookings', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getBooking = (id: string) =>
  request(`/bookings/${id}`, { schema: BookingResponseSchema });
```

```ts
// apps/web/lib/api/events.ts
import { CreateEvent, EventResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(EventResponseSchema);

export const listEvents = (limit: number, cursor: string | null) =>
  request('/events', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getEvent = (id: string) => request(`/events/${id}`, { schema: EventResponseSchema });

export const createEvent = (body: CreateEvent) =>
  request('/events', { method: 'POST', body, schema: EventResponseSchema });
```

```ts
// apps/web/lib/api/flows.ts
import { CreateFlow, FlowResponseSchema, pageOf } from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(FlowResponseSchema);

export const listFlows = (limit: number, cursor: string | null) =>
  request('/flows', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const getFlow = (id: string) => request(`/flows/${id}`, { schema: FlowResponseSchema });

export const createFlow = (body: CreateFlow) =>
  request('/flows', { method: 'POST', body, schema: FlowResponseSchema });

export const executeFlow = (id: string) =>
  request(`/flows/${id}/execute`, { method: 'POST', schema: FlowResponseSchema });
```

```ts
// apps/web/lib/api/schemas.ts
import { SchemaListSchema } from '@marketplace/contracts';
import { request } from './http';

/** One call returns every dynamic entity's schema. */
export const listSchemas = () => request('/schemas', { schema: SchemaListSchema });
```

```ts
// apps/web/lib/api/me.ts
import { PrincipalSchema } from '@marketplace/contracts';
import { request } from './http';

export const getMe = () => request('/me', { schema: PrincipalSchema });
```

- [ ] **Step 6: Verify the whole suite and the type check**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api
git commit -m "feat(web): add the validating API client and resource modules"
```

---

### Task 7: The registry-driven field engine

The core unit. Pure functions, no fetching, no React state.

**Files:**
- Create: `apps/web/lib/schema-fields/index.tsx`, `apps/web/lib/schema-fields/index.test.tsx`

**Interfaces:**
- Consumes: `FieldDefinition`, `FieldType` from `@marketplace/contracts`.
- Produces:
  - `toFormItems(fields: Record<string, FieldDefinition>): ReactNode[]`
  - `toFilterItems(fields: Record<string, FieldDefinition>): ReactNode[]`
  - `toDescriptionRows(fields: Record<string, FieldDefinition>, attributes: Record<string, unknown>): Array<{ key: string; label: string; children: ReactNode }>`
  - `toAttributes(fields: Record<string, FieldDefinition>, values: Record<string, unknown>): Record<string, unknown>`
  - `FILTERABLE_TYPES: readonly FieldType[]`

Form items are namespaced under a single `attributes` field, so `Form`'s values arrive as `{ attributes: { ... } }` and never collide with a core field of the same name.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/lib/schema-fields/index.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import dayjs from 'dayjs';
import type { FieldDefinition } from '@marketplace/contracts';
import { toFormItems, toFilterItems, toDescriptionRows, toAttributes } from './index';

const field = (over: Partial<FieldDefinition>): FieldDefinition => ({
  type: 'string',
  required: false,
  default: null,
  ...over,
});

const fields: Record<string, FieldDefinition> = {
  colour: field({ type: 'string', required: true }),
  weight: field({ type: 'number' }),
  fragile: field({ type: 'boolean' }),
  releasedOn: field({ type: 'date' }),
  tags: field({ type: 'string[]' }),
};

describe('toAttributes', () => {
  it('converts a Dayjs date into an ISO string', () => {
    const out = toAttributes(fields, { releasedOn: dayjs('2026-08-07T00:00:00.000Z') });
    expect(out.releasedOn).toBe('2026-08-07T00:00:00.000Z');
  });

  it('coerces tag-mode strings into numbers for number[] fields', () => {
    const out = toAttributes({ sizes: field({ type: 'number[]' }) }, { sizes: ['1', '2.5'] });
    expect(out.sizes).toEqual([1, 2.5]);
  });

  it('coerces a single number field from a string', () => {
    expect(toAttributes(fields, { weight: '12' }).weight).toBe(12);
  });

  it('drops keys that are absent or undefined rather than sending nulls', () => {
    expect(toAttributes(fields, { colour: 'red' })).toEqual({ colour: 'red' });
  });

  it('ignores values for names not in the schema', () => {
    expect(toAttributes(fields, { colour: 'red', bogus: 'x' })).toEqual({ colour: 'red' });
  });

  it('converts an array of Dayjs values for a date[] field', () => {
    const out = toAttributes(
      { window: field({ type: 'date[]' }) },
      { window: [dayjs('2026-01-01T00:00:00.000Z')] },
    );
    expect(out.window).toEqual(['2026-01-01T00:00:00.000Z']);
  });
});

describe('toFilterItems', () => {
  it('emits controls only for scalar equality-filterable types', () => {
    render(<Form>{toFilterItems(fields)}</Form>);
    expect(screen.getByLabelText('colour')).toBeInTheDocument();
    expect(screen.getByLabelText('weight')).toBeInTheDocument();
    expect(screen.getByLabelText('fragile')).toBeInTheDocument();
    // SearchProductsSchema types attributes as string | number | boolean:
    // arrays cannot be matched, and exact-match on a timestamp is useless.
    expect(screen.queryByLabelText('tags')).toBeNull();
    expect(screen.queryByLabelText('releasedOn')).toBeNull();
  });
});

describe('toFormItems', () => {
  it('renders one labelled control per field', () => {
    render(<Form>{toFormItems(fields)}</Form>);
    for (const name of Object.keys(fields)) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });
});

describe('toDescriptionRows', () => {
  it('renders a row per field and shows an em dash for a missing value', () => {
    const rows = toDescriptionRows(fields, { colour: 'red' });
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.key === 'colour')!.children).toBe('red');
    expect(rows.find((r) => r.key === 'weight')!.children).toBe('—');
  });

  it('joins array values with commas', () => {
    const rows = toDescriptionRows(fields, { tags: ['a', 'b'] });
    expect(rows.find((r) => r.key === 'tags')!.children).toBe('a, b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- schema-fields`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/lib/schema-fields/index.tsx
'use client';

import { Button, DatePicker, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import dayjs from 'dayjs';
import type { ReactNode } from 'react';
import type { FieldDefinition, FieldType } from '@marketplace/contracts';

/**
 * SearchProductsSchema types `attributes` as
 * Record<string, string | number | boolean> -- scalar equality only. Arrays
 * cannot be expressed at all, and an exact match on a timestamp is useless,
 * so `date` is left out too. Range filtering exists only on the core
 * priceMinor field, which is a hand-written control, not a generated one.
 */
export const FILTERABLE_TYPES = ['string', 'number', 'boolean'] as const satisfies readonly FieldType[];

const isArrayType = (type: FieldType) => type.endsWith('[]');
const scalarOf = (type: FieldType) => type.replace('[]', '') as FieldType;

function scalarControl(type: FieldType): ReactNode {
  switch (scalarOf(type)) {
    case 'number':
      return <InputNumber style={{ width: '100%' }} />;
    case 'boolean':
      return <Switch />;
    case 'date':
      return <DatePicker style={{ width: '100%' }} />;
    default:
      return <Input />;
  }
}

export function toFormItems(fields: Record<string, FieldDefinition>): ReactNode[] {
  return Object.entries(fields).map(([name, def]) => {
    const rules = def.required ? [{ required: true, message: `${name} is required` }] : undefined;
    const initialValue = def.default ?? undefined;

    // Tag-mode Select handles free-form string and number arrays in one
    // control. boolean[] and date[] have no sensible tag input, so they get a
    // repeatable list of the scalar control instead.
    if (def.type === 'string[]' || def.type === 'number[]') {
      return (
        <Form.Item key={name} name={['attributes', name]} label={name} rules={rules}>
          <Select mode="tags" tokenSeparators={[',']} open={false} />
        </Form.Item>
      );
    }

    if (isArrayType(def.type)) {
      return (
        <Form.List key={name} name={['attributes', name]}>
          {(entries, { add, remove }) => (
            <Form.Item label={name} required={def.required}>
              {entries.map((entry) => (
                <Space key={entry.key} align="baseline">
                  <Form.Item {...entry} noStyle>
                    {scalarControl(def.type)}
                  </Form.Item>
                  <Button onClick={() => remove(entry.name)}>Remove</Button>
                </Space>
              ))}
              <Button onClick={() => add()}>Add {name}</Button>
            </Form.Item>
          )}
        </Form.List>
      );
    }

    return (
      <Form.Item
        key={name}
        name={['attributes', name]}
        label={name}
        rules={rules}
        initialValue={initialValue}
        valuePropName={def.type === 'boolean' ? 'checked' : undefined}
      >
        {scalarControl(def.type)}
      </Form.Item>
    );
  });
}

export function toFilterItems(fields: Record<string, FieldDefinition>): ReactNode[] {
  return Object.entries(fields)
    .filter(([, def]) => (FILTERABLE_TYPES as readonly string[]).includes(def.type))
    .map(([name, def]) => (
      <Form.Item
        key={name}
        name={['attributes', name]}
        label={name}
        valuePropName={def.type === 'boolean' ? 'checked' : undefined}
      >
        {scalarControl(def.type)}
      </Form.Item>
    ));
}

const display = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
};

export function toDescriptionRows(
  fields: Record<string, FieldDefinition>,
  attributes: Record<string, unknown>,
): Array<{ key: string; label: string; children: ReactNode }> {
  return Object.keys(fields).map((name) => ({
    key: name,
    label: name,
    children: display(attributes[name]),
  }));
}

const coerceScalar = (type: FieldType, value: unknown): unknown => {
  switch (scalarOf(type)) {
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return Boolean(value);
    case 'date':
      // ANTD DatePicker yields a Dayjs; the wire wants an ISO 8601 string.
      return dayjs.isDayjs(value) ? value.toISOString() : String(value);
    default:
      return String(value);
  }
};

/**
 * ANTD returns Dayjs objects and tag-mode strings. The wire needs ISO strings
 * and real numbers, and the registry's validator rejects the wrong type -- so
 * this conversion is the difference between a working submit and a 400.
 */
export function toAttributes(
  fields: Record<string, FieldDefinition>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(fields)) {
    const value = values[name];
    // Absent means absent. Sending null for an untouched optional field would
    // fail validation for any type other than the one it was declared as.
    if (value === undefined || value === null || value === '') continue;

    out[name] = isArrayType(def.type)
      ? (Array.isArray(value) ? value : [value]).map((item) => coerceScalar(def.type, item))
      : coerceScalar(def.type, value);
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- schema-fields`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/schema-fields
git commit -m "feat(web): generate form, filter and detail fields from the tenant schema"
```

---

### Task 8: Schema cache and the app shell

**Files:**
- Create: `apps/web/lib/schemas/schema-cache.tsx`, `apps/web/lib/schemas/schema-cache.test.tsx`
- Create: `apps/web/lib/problem-notify.ts`, `apps/web/components/app-shell.tsx`, `apps/web/components/contract-banner.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: `listSchemas`, `ProblemError`, `ContractMismatchError`, `onUnauthorized` (Task 6); `useAuth` (Task 5).
- Produces: `SchemaProvider`, `useSchemas(): { schemas: Record<DynamicEntityType, SchemaView> | null; loading: boolean; refresh(): Promise<void> }`, `useSchema(entityType: DynamicEntityType): SchemaView | null`, `AppShell`, `ContractBanner`, `notifyProblem(err: unknown): void`, `toFormErrors(err: unknown): { name: string; errors: string[] }[]`, `onContractMismatch(handler): () => void`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/lib/schemas/schema-cache.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { SchemaProvider, useSchema, useSchemas } from './schema-cache';
import * as api from '../api/schemas';

const view = (version: number, fields: Record<string, unknown>) => ({
  entityType: 'Product',
  version,
  fields,
});

function Probe() {
  const product = useSchema('Product');
  const { refresh } = useSchemas();
  return (
    <div>
      <span data-testid="names">{Object.keys(product?.fields ?? {}).join(',')}</span>
      <button onClick={() => refresh()}>refresh</button>
    </div>
  );
}

describe('SchemaProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches every schema once and exposes them by entity type', async () => {
    const spy = vi
      .spyOn(api, 'listSchemas')
      .mockResolvedValue({ items: [view(1, { colour: {} })] } as never);

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});

    expect(spy).toHaveBeenCalledOnce();
    expect(screen.getByTestId('names')).toHaveTextContent('colour');
  });

  it('re-reads after refresh so a newly executed flow shows its field', async () => {
    const spy = vi
      .spyOn(api, 'listSchemas')
      .mockResolvedValueOnce({ items: [view(1, { colour: {} })] } as never)
      .mockResolvedValueOnce({ items: [view(2, { colour: {}, weight: {} })] } as never);

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});
    await act(async () => {
      screen.getByText('refresh').click();
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('names')).toHaveTextContent('colour,weight');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- schema-cache`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the cache**

```tsx
// apps/web/lib/schemas/schema-cache.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { DynamicEntityType, SchemaView } from '@marketplace/contracts';
import { listSchemas } from '../api/schemas';
import { useAuth } from '../auth/auth-context';

type SchemaMap = Partial<Record<DynamicEntityType, SchemaView>>;

interface SchemaValue {
  schemas: SchemaMap | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SchemaContext = createContext<SchemaValue | null>(null);

export function SchemaProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [schemas, setSchemas] = useState<SchemaMap | null>(null);
  const [loading, setLoading] = useState(false);

  // GET /schemas returns all four entity types in one response, so this is one
  // call rather than four, and one eviction rather than four.
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await listSchemas();
      setSchemas(Object.fromEntries(items.map((item) => [item.entityType, item])) as SchemaMap);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void refresh();
    else setSchemas(null);
  }, [token, refresh]);

  return (
    <SchemaContext.Provider value={{ schemas, loading, refresh }}>{children}</SchemaContext.Provider>
  );
}

export function useSchemas(): SchemaValue {
  const value = useContext(SchemaContext);
  if (!value) throw new Error('useSchemas must be used inside SchemaProvider');
  return value;
}

export function useSchema(entityType: DynamicEntityType): SchemaView | null {
  return useSchemas().schemas?.[entityType] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- schema-cache`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the error surface and the app shell**

```ts
// apps/web/lib/problem-notify.ts
import { notification } from 'antd';
import { ContractMismatchError, ProblemError } from './api/http';

let mismatchHandler: ((err: ContractMismatchError) => void) | null = null;

/** Subscribe the banner. Returns an unsubscribe function for useEffect. */
export function onContractMismatch(handler: (err: ContractMismatchError) => void): () => void {
  mismatchHandler = handler;
  return () => {
    mismatchHandler = null;
  };
}

/**
 * A ProblemError always carries a traceId -- both services' ProblemFilter adds
 * one to every response it writes. Showing it is what makes a failure a user
 * reports traceable in the server logs.
 */
export function notifyProblem(err: unknown): void {
  if (err instanceof ProblemError) {
    notification.error({
      message: err.title,
      description: [err.detail, err.traceId && `trace: ${err.traceId}`].filter(Boolean).join(' · '),
      duration: 8,
    });
    return;
  }
  // A contract mismatch goes to the banner, not to a toast that disappears.
  // Routing it through a subscription rather than re-throwing matters: every
  // caller here is an async `.catch()`, and a re-throw from there is an
  // unhandled rejection no error boundary would ever see.
  if (err instanceof ContractMismatchError) {
    if (mismatchHandler) mismatchHandler(err);
    else notification.error({ message: 'Contract mismatch', description: err.message });
    return;
  }
  notification.error({ message: 'Unexpected error', description: String(err) });
}

/**
 * Maps a 400's `errors[]` onto ANTD form fields where the names line up.
 * Returns whatever could be mapped, for the caller to pass to form.setFields.
 */
export function toFormErrors(err: unknown): { name: string; errors: string[] }[] {
  if (!(err instanceof ProblemError)) return [];
  return err.errors
    .filter((e) => typeof e.path === 'string' && e.path.length > 0)
    .map((e) => ({ name: e.path, errors: [e.message] }));
}
```

```tsx
// apps/web/components/app-shell.tsx
'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Layout, Menu, Space, Tag } from 'antd';
import { useAuth } from '../lib/auth/auth-context';
import { onUnauthorized } from '../lib/api/http';

const BUYER_ITEMS = [
  { key: '/products', label: <Link href="/products">Products</Link> },
  { key: '/events', label: <Link href="/events">Events</Link> },
  { key: '/cart', label: <Link href="/cart">Cart</Link> },
  { key: '/orders', label: <Link href="/orders">Orders</Link> },
  { key: '/bookings', label: <Link href="/bookings">Bookings</Link> },
];

const ADMIN_ITEMS = [
  { key: '/admin/products/new', label: <Link href="/admin/products/new">New product</Link> },
  { key: '/admin/events/new', label: <Link href="/admin/events/new">New event</Link> },
  { key: '/admin/flows', label: <Link href="/admin/flows">Flows</Link> },
  { key: '/admin/chat', label: <Link href="/admin/chat">Chat</Link> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { principal, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  useEffect(() => {
    if (ready && !principal && pathname !== '/login') router.push('/login');
  }, [ready, principal, pathname, router]);

  if (pathname === '/login') return <>{children}</>;
  if (!ready || !principal) return null;

  // Admins get the buyer views too -- they browse their own catalogue. This is
  // navigation only: the engine enforces tenant isolation on every route and
  // enforces nothing about role, so an admin URL typed by hand works for a
  // buyer. See packages/contracts/src/flow.ts.
  const items = principal.role === 'admin' ? [...BUYER_ITEMS, ...ADMIN_ITEMS] : BUYER_ITEMS;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Menu theme="dark" mode="horizontal" selectedKeys={[pathname]} items={items} style={{ flex: 1 }} />
        <Space>
          <Tag color="blue">{principal.tenantId}</Tag>
          <Tag>{principal.role ?? 'no role'}</Tag>
          <Button size="small" onClick={signOut}>
            Sign out
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
    </Layout>
  );
}
```

```tsx
// apps/web/components/contract-banner.tsx
'use client';

import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import type { ContractMismatchError } from '../lib/api/http';
import { onContractMismatch } from '../lib/problem-notify';

/**
 * A contract mismatch means this client and the service disagree about
 * @marketplace/contracts -- a build-level defect a user cannot retry past, so
 * it gets a persistent banner rather than a toast.
 *
 * A React error boundary would be the obvious mechanism and is the wrong one:
 * every one of these errors surfaces inside an async `.catch()`, and boundaries
 * only catch errors thrown during render. A subscription works from anywhere.
 */
export function ContractBanner() {
  const [error, setError] = useState<ContractMismatchError | null>(null);

  useEffect(() => onContractMismatch(setError), []);

  if (!error) return null;
  return (
    <Alert
      type="error"
      banner
      closable
      onClose={() => setError(null)}
      message="Client and server contracts disagree"
      description={`${error.message}. Rebuild @marketplace/contracts and both services.`}
    />
  );
}
```

Rewrite `app/layout.tsx` to nest the providers:

```tsx
// apps/web/app/layout.tsx
import { AntdRegistry } from '@ant-design/nextjs-registry';
import '@ant-design/v5-patch-for-react-19';
import { AuthProvider } from '../lib/auth/auth-context';
import { SchemaProvider } from '../lib/schemas/schema-cache';
import { ContractBanner } from '../components/contract-banner';
import { AppShell } from '../components/app-shell';

export const metadata = { title: 'Marketplace' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AntdRegistry>
          <AuthProvider>
            <SchemaProvider>
              <ContractBanner />
              <AppShell>{children}</AppShell>
            </SchemaProvider>
          </AuthProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
```

`SchemaProvider` sits inside `AuthProvider` because it fetches whenever `token` changes. `ContractBanner` is a sibling above `AppShell`, not a wrapper: it renders nothing until something reports a mismatch, and it must stay mounted while the page below it keeps working.

Task 10 adds `CartProvider` to this file, between `SchemaProvider` and `ContractBanner`.

- [ ] **Step 6: Verify the shell renders in Docker**

Run: `pnpm docker:down && pnpm docker:up`
Open `http://localhost:3002`, sign in as `acme-admin`.
Expected: redirected to `/products`, the header shows the `acme` and `admin` tags, and the admin menu entries are present. Sign out as `acme-buyer` and confirm the admin entries are gone.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): cache tenant schemas and add the role-driven app shell"
```

---

### Task 9: Products — list, search, detail, and admin create

**Files:**
- Create: `apps/web/components/cursor-table.tsx`, `apps/web/components/cursor-table.test.tsx`
- Create: `apps/web/app/products/page.tsx`, `apps/web/app/products/[id]/page.tsx`
- Create: `apps/web/app/admin/products/new/page.tsx`

**Interfaces:**
- Consumes: `listProducts`, `searchProducts`, `getProduct`, `createProduct` (Task 6); `toFormItems`, `toFilterItems`, `toDescriptionRows`, `toAttributes` (Task 7); `useSchema`, `notifyProblem`, `toFormErrors` (Task 8); `useCart` (Task 10 — the detail page's "Add to cart" needs it, so build Task 10's context first or stub the import).
- Produces: `CursorTable<T>` — props `{ columns, load, rowKey, reloadToken? }` where `load(cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/cursor-table.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CursorTable } from './cursor-table';

describe('CursorTable', () => {
  it('appends the next page and hides Load more when the cursor runs out', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [{ id: 'b', name: 'B' }], nextCursor: null });

    render(
      <CursorTable
        rowKey="id"
        columns={[{ title: 'Name', dataIndex: 'name' }]}
        load={load}
      />,
    );

    await act(async () => {});
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).toBeNull();

    await act(async () => {
      screen.getByText('Load more').click();
    });

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(load).toHaveBeenNthCalledWith(2, 'c1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- cursor-table`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the shared components**

```tsx
// apps/web/components/cursor-table.tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { notifyProblem } from '../lib/problem-notify';

interface Props<T> {
  columns: ColumnsType<T>;
  rowKey: string;
  load: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Change this to discard the accumulated pages and reload from the start. */
  reloadToken?: unknown;
}

/**
 * The API pages by opaque cursor and returns no total, so ANTD's built-in
 * pagination -- which needs one -- cannot be used. Pages accumulate instead.
 */
export function CursorTable<T extends object>({ columns, rowKey, load, reloadToken }: Props<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(
    async (from: string | null, append: boolean) => {
      setLoading(true);
      try {
        const page = await load(from);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (err) {
        notifyProblem(err);
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    void fetchPage(null, false);
  }, [fetchPage, reloadToken]);

  return (
    <>
      <Table<T> rowKey={rowKey} columns={columns} dataSource={items} pagination={false} loading={loading} />
      {!done && (
        <Button style={{ marginTop: 16 }} loading={loading} onClick={() => void fetchPage(cursor, true)}>
          Load more
        </Button>
      )}
    </>
  );
}
```

```ts
// apps/web/lib/problem-notify.ts  (created in Task 8 — shown here for reference only)
import { notification } from 'antd';
import { ContractMismatchError, ProblemError } from './api/http';

/**
 * A ProblemError always carries a traceId -- both services' ProblemFilter adds
 * one to every response it writes. Showing it is what makes a failure a user
 * reports traceable in the server logs.
 */
let mismatchHandler: ((err: ContractMismatchError) => void) | null = null;

/** Subscribe the banner. Returns an unsubscribe function for useEffect. */
export function onContractMismatch(handler: (err: ContractMismatchError) => void): () => void {
  mismatchHandler = handler;
  return () => {
    mismatchHandler = null;
  };
}

export function notifyProblem(err: unknown): void {
  if (err instanceof ProblemError) {
    notification.error({
      message: err.title,
      description: [err.detail, err.traceId && `trace: ${err.traceId}`].filter(Boolean).join(' · '),
      duration: 8,
    });
    return;
  }
  // A contract mismatch goes to the banner, not to a toast that disappears.
  // Routing it through a subscription rather than re-throwing matters: every
  // caller here is an async `.catch()`, and a re-throw from there is an
  // unhandled rejection no error boundary would ever see.
  if (err instanceof ContractMismatchError) {
    if (mismatchHandler) mismatchHandler(err);
    else notification.error({ message: 'Contract mismatch', description: err.message });
    return;
  }
  notification.error({ message: 'Unexpected error', description: String(err) });
}

/**
 * Maps a 400's `errors[]` onto ANTD form fields where the names line up.
 * Returns whatever could not be mapped, for the caller to show generically.
 */
export function toFormErrors(
  err: unknown,
): { name: string; errors: string[] }[] {
  if (!(err instanceof ProblemError)) return [];
  return err.errors
    .filter((e) => typeof e.path === 'string' && e.path.length > 0)
    .map((e) => ({ name: e.path, errors: [e.message] }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- cursor-table`
Expected: PASS, 1 test.

- [ ] **Step 5: Write the products list with generated filters**

```tsx
// apps/web/app/products/page.tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Form, InputNumber, Space } from 'antd';
import type { SearchProducts, ProductResponse } from '@marketplace/contracts';
import { listProducts, searchProducts } from '../../lib/api/products';
import { CursorTable } from '../../components/cursor-table';
import { toAttributes, toFilterItems } from '../../lib/schema-fields';
import { useSchema } from '../../lib/schemas/schema-cache';

export default function ProductsPage() {
  const schema = useSchema('Product');
  const [filters, setFilters] = useState<Partial<SearchProducts> | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(
    (cursor: string | null) =>
      filters
        ? searchProducts({ ...filters, attributes: filters.attributes ?? {}, limit: 25, cursor })
        : listProducts(25, cursor),
    [filters],
  );

  const columns = useMemo(
    () => [
      {
        title: 'Name',
        dataIndex: 'name',
        render: (name: string, row: ProductResponse) => <Link href={`/products/${row.id}`}>{name}</Link>,
      },
      { title: 'Category', dataIndex: 'category' },
      {
        title: 'Price',
        dataIndex: 'priceMinor',
        render: (minor: number, row: ProductResponse) => `${(minor / 100).toFixed(2)} ${row.currency}`,
      },
      { title: 'Stock', dataIndex: 'stock' },
    ],
    [],
  );

  const apply = (values: Record<string, unknown>) => {
    const attributes = schema
      ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
      : {};
    setFilters({
      priceMinorMin: values.priceMinorMin as number | undefined,
      priceMinorMax: values.priceMinorMax as number | undefined,
      attributes: attributes as SearchProducts['attributes'],
    });
    setReloadToken((n) => n + 1);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Card title="Filters" size="small">
        <Form layout="inline" onFinish={apply}>
          <Form.Item name="priceMinorMin" label="Min price (minor)">
            <InputNumber />
          </Form.Item>
          <Form.Item name="priceMinorMax" label="Max price (minor)">
            <InputNumber />
          </Form.Item>
          {schema ? toFilterItems(schema.fields) : null}
          <Button type="primary" htmlType="submit">
            Search
          </Button>
          <Button
            onClick={() => {
              setFilters(null);
              setReloadToken((n) => n + 1);
            }}
          >
            Clear
          </Button>
        </Form>
      </Card>
      <CursorTable rowKey="id" columns={columns} load={load} reloadToken={reloadToken} />
    </Space>
  );
}
```

- [ ] **Step 6: Write the product detail page**

```tsx
// apps/web/app/products/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Descriptions, InputNumber, Space, Spin, message } from 'antd';
import type { ProductResponse } from '@marketplace/contracts';
import { getProduct } from '../../../lib/api/products';
import { toDescriptionRows } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { useCart } from '../../../lib/cart/cart-context';
import { notifyProblem } from '../../../lib/problem-notify';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Product');
  const { add } = useCart();
  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    getProduct(id).then(setProduct).catch(notifyProblem);
  }, [id]);

  if (!product) return <Spin />;

  return (
    <Card title={product.name}>
      <Descriptions
        column={1}
        items={[
          { key: 'description', label: 'Description', children: product.description },
          { key: 'category', label: 'Category', children: product.category },
          {
            key: 'price',
            label: 'Price',
            children: `${(product.priceMinor / 100).toFixed(2)} ${product.currency}`,
          },
          { key: 'stock', label: 'Stock', children: product.stock },
          ...(schema ? toDescriptionRows(schema.fields, product.attributes) : []),
        ]}
      />
      <Space style={{ marginTop: 16 }}>
        <InputNumber min={1} max={product.stock} value={qty} onChange={(v) => setQty(v ?? 1)} />
        <Button
          type="primary"
          disabled={product.stock < 1}
          onClick={() => {
            add({ productId: product.id, name: product.name, priceMinor: product.priceMinor, qty });
            void message.success(`${product.name} added to cart`);
          }}
        >
          Add to cart
        </Button>
      </Space>
    </Card>
  );
}
```

- [ ] **Step 7: Write the admin create-product page**

```tsx
// apps/web/app/admin/products/new/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, Form, Input, InputNumber, Select, message } from 'antd';
import { createProduct } from '../../../../lib/api/products';
import { toAttributes, toFormItems } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { notifyProblem, toFormErrors } from '../../../../lib/problem-notify';

export default function NewProductPage() {
  const schema = useSchema('Product');
  const router = useRouter();
  const [form] = Form.useForm();

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createProduct({
        name: values.name as string,
        description: values.description as string,
        priceMinor: values.priceMinor as number,
        currency: values.currency as string,
        category: values.category as string,
        stock: values.stock as number,
        images: [],
        attributes: schema
          ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
          : {},
      });
      void message.success('Product created');
      router.push(`/products/${created.id}`);
    } catch (err) {
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <Card title="New product" style={{ maxWidth: 640 }}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ currency: 'USD', stock: 0 }}>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="Description" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.Item name="category" label="Category" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="priceMinor" label="Price (minor units)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
          <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
        </Form.Item>
        <Form.Item name="stock" label="Stock" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        {schema ? toFormItems(schema.fields) : null}
        <Button type="primary" htmlType="submit">
          Create
        </Button>
      </Form>
    </Card>
  );
}
```

Confirm `CreateProductSchema` in `packages/contracts/src/product.ts` matches these field names before running; correct the form if it differs.

- [ ] **Step 8: Verify against the live stack**

Run: `pnpm docker:up`, sign in as `acme-admin`, create a product, then open it from `/products`.
Expected: the product appears in the list, its detail page shows the core fields, and a search on price range narrows the list.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat(web): product list, generated search filters, detail and create"
```

---

### Task 10: Cart, checkout and orders

**Files:**
- Create: `apps/web/lib/cart/cart-context.tsx`, `apps/web/lib/cart/cart-context.test.tsx`
- Create: `apps/web/app/cart/page.tsx`, `apps/web/app/orders/page.tsx`, `apps/web/app/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `createOrder`, `listOrders`, `getOrder` (Task 6); `CursorTable` (Task 9).
- Produces: `CartProvider`, `useCart(): { lines: CartLine[]; add(line: CartLine): void; setQty(productId: string, qty: number): void; remove(productId: string): void; clear(): void; idempotencyKey: string; resetKey(): void }` where `CartLine = { productId: string; name: string; priceMinor: number; qty: number }`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/lib/cart/cart-context.test.tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CartProvider, useCart } from './cart-context';

function Probe() {
  const { lines, add, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  return (
    <div>
      <span data-testid="count">{lines.length}</span>
      <span data-testid="qty">{lines[0]?.qty ?? 0}</span>
      <span data-testid="key">{idempotencyKey}</span>
      <button onClick={() => add({ productId: 'p1', name: 'P1', priceMinor: 100, qty: 1 })}>add</button>
      <button onClick={() => setQty('p1', 5)}>qty</button>
      <button onClick={() => remove('p1')}>remove</button>
      <button onClick={() => clear()}>clear</button>
      <button onClick={() => resetKey()}>reset</button>
    </div>
  );
}

const click = async (label: string) =>
  act(async () => {
    screen.getByText(label).click();
  });

describe('CartProvider', () => {
  beforeEach(() => sessionStorage.clear());

  it('merges quantity when the same product is added twice', async () => {
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await click('add');
    await click('add');
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('qty')).toHaveTextContent('2');
  });

  it('keeps one idempotency key across the life of an intent', async () => {
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    const first = screen.getByTestId('key').textContent;
    await click('add');
    await click('qty');
    // Editing the cart must NOT mint a new key: a retry after a network drop
    // has to reuse it or the engine will create a second order.
    expect(screen.getByTestId('key')).toHaveTextContent(first!);

    await click('reset');
    expect(screen.getByTestId('key').textContent).not.toBe(first);
  });

  it('persists lines across a remount', async () => {
    const { unmount } = render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await click('add');
    unmount();

    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await act(async () => {});
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- cart-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the cart**

```tsx
// apps/web/lib/cart/cart-context.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface CartLine {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
}

const LINES_KEY = 'marketplace.cart';
const KEY_KEY = 'marketplace.cart.idempotencyKey';

interface CartValue {
  lines: CartLine[];
  add: (line: CartLine) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  idempotencyKey: string;
  resetKey: () => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  useEffect(() => {
    const storedLines = sessionStorage.getItem(LINES_KEY);
    if (storedLines) setLines(JSON.parse(storedLines) as CartLine[]);

    // The key belongs to the *intent*, not to the click. It is minted once and
    // reused by every retry -- a double-click, a 409 request-in-progress
    // backoff, or a retry after a dropped connection all send the same key, so
    // the engine replays the first response instead of creating a second order.
    const storedKey = sessionStorage.getItem(KEY_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, storedKey);
    setIdempotencyKey(storedKey);
  }, []);

  const persist = useCallback((next: CartLine[]) => {
    setLines(next);
    sessionStorage.setItem(LINES_KEY, JSON.stringify(next));
  }, []);

  const add = useCallback(
    (line: CartLine) =>
      setLines((prev) => {
        const existing = prev.find((l) => l.productId === line.productId);
        const next = existing
          ? prev.map((l) => (l.productId === line.productId ? { ...l, qty: l.qty + line.qty } : l))
          : [...prev, line];
        sessionStorage.setItem(LINES_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );

  const setQty = useCallback(
    (productId: string, qty: number) =>
      setLines((prev) => {
        const next = prev.map((l) => (l.productId === productId ? { ...l, qty } : l));
        sessionStorage.setItem(LINES_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );

  const remove = useCallback(
    (productId: string) =>
      setLines((prev) => {
        const next = prev.filter((l) => l.productId !== productId);
        sessionStorage.setItem(LINES_KEY, JSON.stringify(next));
        return next;
      }),
    [],
  );

  const clear = useCallback(() => persist([]), [persist]);

  /** Call only after a successful order, or an explicit abandon. */
  const resetKey = useCallback(() => {
    const next = crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, next);
    setIdempotencyKey(next);
  }, []);

  return (
    <CartContext.Provider value={{ lines, add, setQty, remove, clear, idempotencyKey, resetKey }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
```

Add `CartProvider` to `app/layout.tsx`, nested inside `SchemaProvider` and wrapping both `ContractBanner` and `AppShell`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- cart-context`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the checkout page with the 409 retry**

```tsx
// apps/web/app/cart/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Empty, Form, Input, InputNumber, Select, Table, message } from 'antd';
import { createOrder } from '../../lib/api/orders';
import { useCart } from '../../lib/cart/cart-context';
import { ProblemError } from '../../lib/api/http';
import { notifyProblem } from '../../lib/problem-notify';
import { toAttributes, toFormItems } from '../../lib/schema-fields';
import { useSchema } from '../../lib/schemas/schema-cache';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CartPage() {
  const { lines, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  const schema = useSchema('Order');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      const body = {
        items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
        currency: values.currency as string,
        shippingAddress: {
          line1: values.line1 as string,
          city: values.city as string,
          postcode: values.postcode as string,
        },
        attributes: schema
          ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
          : {},
      };

      // Every attempt reuses the same key. A 409 means the first attempt is
      // still in flight, not that anything is wrong -- backing off with the
      // same key eventually returns that first attempt's stored response.
      for (let attempt = 0; ; attempt++) {
        try {
          const order = await createOrder(body, idempotencyKey);
          clear();
          resetKey();
          void message.success('Order placed');
          router.push(`/orders/${order.id}`);
          return;
        } catch (err) {
          const inProgress = err instanceof ProblemError && err.status === 409;
          if (!inProgress || attempt >= BACKOFFS_MS.length - 1) throw err;
          await sleep(BACKOFFS_MS[attempt]);
        }
      }
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  if (!lines.length) return <Empty description="Your cart is empty" />;

  return (
    <Card title="Cart" style={{ maxWidth: 720 }}>
      <Table
        rowKey="productId"
        pagination={false}
        dataSource={lines}
        columns={[
          { title: 'Product', dataIndex: 'name' },
          {
            title: 'Qty',
            dataIndex: 'qty',
            render: (qty: number, row) => (
              <InputNumber min={1} value={qty} onChange={(v) => setQty(row.productId, v ?? 1)} />
            ),
          },
          {
            title: '',
            render: (_, row) => <Button onClick={() => remove(row.productId)}>Remove</Button>,
          },
        ]}
      />
      <Form layout="vertical" onFinish={submit} initialValues={{ currency: 'USD' }} style={{ marginTop: 24 }}>
        <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
          <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
        </Form.Item>
        <Form.Item name="line1" label="Address" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="city" label="City" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="postcode" label="Postcode" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        {schema ? toFormItems(schema.fields) : null}
        <Button type="primary" htmlType="submit" loading={busy} disabled={busy}>
          Place order
        </Button>
      </Form>
    </Card>
  );
}
```

- [ ] **Step 6: Write the orders list and detail**

```tsx
// apps/web/app/orders/page.tsx
'use client';

import Link from 'next/link';
import type { OrderResponse } from '@marketplace/contracts';
import { listOrders } from '../../lib/api/orders';
import { CursorTable } from '../../components/cursor-table';

export default function OrdersPage() {
  return (
    <CursorTable<OrderResponse>
      rowKey="id"
      load={(cursor) => listOrders(25, cursor)}
      columns={[
        { title: 'Order', dataIndex: 'id', render: (id: string) => <Link href={`/orders/${id}`}>{id}</Link> },
        { title: 'Status', dataIndex: 'status' },
        {
          title: 'Total',
          dataIndex: 'totalAmountMinor',
          render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
        },
        { title: 'Placed', dataIndex: 'createdAt' },
      ]}
    />
  );
}
```

```tsx
// apps/web/app/orders/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Spin, Table } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { getOrder } from '../../../lib/api/orders';
import { toDescriptionRows } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../lib/problem-notify';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Order');
  const [order, setOrder] = useState<OrderResponse | null>(null);

  useEffect(() => {
    getOrder(id).then(setOrder).catch(notifyProblem);
  }, [id]);

  if (!order) return <Spin />;

  return (
    <Card title={`Order ${order.id}`}>
      <Descriptions
        column={1}
        items={[
          { key: 'status', label: 'Status', children: order.status },
          {
            key: 'total',
            label: 'Total',
            children: `${(order.totalAmountMinor / 100).toFixed(2)} ${order.currency}`,
          },
          { key: 'placed', label: 'Placed', children: order.createdAt },
          ...(schema ? toDescriptionRows(schema.fields, order.attributes) : []),
        ]}
      />
      <Table
        style={{ marginTop: 16 }}
        rowKey="productId"
        pagination={false}
        dataSource={order.items}
        columns={[
          { title: 'Product', dataIndex: 'productId' },
          { title: 'Qty', dataIndex: 'quantity' },
          {
            title: 'Unit price',
            dataIndex: 'unitPriceMinor',
            render: (minor: number) => (minor / 100).toFixed(2),
          },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 7: Verify against the live stack**

Sign in as `acme-buyer`, add two different products, place the order, and confirm the detail page shows both line items with locked unit prices. Then double-click "Place order" on a fresh cart and confirm `/orders` gains exactly one row.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): cart, idempotent checkout and order views"
```

---

### Task 11: Events and bookings

**Files:**
- Create: `apps/web/app/events/page.tsx`, `apps/web/app/events/[id]/page.tsx`
- Create: `apps/web/app/bookings/page.tsx`, `apps/web/app/bookings/[id]/page.tsx`
- Create: `apps/web/app/admin/events/new/page.tsx`

**Interfaces:**
- Consumes: `listEvents`, `getEvent`, `createEvent`, `createBooking`, `listBookings`, `getBooking` (Task 6); `CursorTable` (Task 9); `toFormItems`, `toDescriptionRows`, `toAttributes` (Task 7).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the events list**

```tsx
// apps/web/app/events/page.tsx
'use client';

import Link from 'next/link';
import type { EventResponse } from '@marketplace/contracts';
import { listEvents } from '../../lib/api/events';
import { CursorTable } from '../../components/cursor-table';

export default function EventsPage() {
  return (
    <CursorTable<EventResponse>
      rowKey="id"
      load={(cursor) => listEvents(25, cursor)}
      columns={[
        {
          title: 'Title',
          dataIndex: 'title',
          render: (title: string, row) => <Link href={`/events/${row.id}`}>{title}</Link>,
        },
        { title: 'Starts', dataIndex: 'startDate' },
        { title: 'Capacity', dataIndex: 'capacity' },
        { title: 'Booked', dataIndex: 'booked' },
        {
          title: 'Price',
          dataIndex: 'basePriceMinor',
          render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
        },
      ]}
    />
  );
}
```

If Step 5 of Task 1 found that `EventResponse` has no `booked` field, drop that column.

- [ ] **Step 2: Write the event detail with a booking form**

The booking form mints its own idempotency key when the form is first shown, not when the button is clicked — the same rule as the cart.

```tsx
// apps/web/app/events/[id]/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Descriptions, Form, InputNumber, Spin, message } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { getEvent } from '../../../lib/api/events';
import { createBooking } from '../../../lib/api/bookings';
import { toAttributes, toDescriptionRows, toFormItems } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { ProblemError } from '../../../lib/api/http';
import { notifyProblem } from '../../../lib/problem-notify';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const eventSchema = useSchema('Event');
  const bookingSchema = useSchema('Booking');
  const [event, setEvent] = useState<EventResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Minted when the intent forms -- on mount -- not on click, so every retry
  // reuses it and the engine replays instead of double-booking.
  const idempotencyKey = useRef<string>('');
  if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

  useEffect(() => {
    getEvent(id).then(setEvent).catch(notifyProblem);
  }, [id]);

  if (!event) return <Spin />;

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      const body = {
        eventId: event.id,
        ticketQuantity: values.ticketQuantity as number,
        attributes: bookingSchema
          ? toAttributes(bookingSchema.fields, (values.attributes ?? {}) as Record<string, unknown>)
          : {},
      };

      for (let attempt = 0; ; attempt++) {
        try {
          const booking = await createBooking(body, idempotencyKey.current);
          void message.success('Booked');
          router.push(`/bookings/${booking.id}`);
          return;
        } catch (err) {
          const inProgress = err instanceof ProblemError && err.status === 409;
          if (!inProgress || attempt >= BACKOFFS_MS.length - 1) throw err;
          await sleep(BACKOFFS_MS[attempt]);
        }
      }
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={event.title}>
      <Descriptions
        column={1}
        items={[
          { key: 'start', label: 'Starts', children: event.startDate },
          { key: 'end', label: 'Ends', children: event.endDate },
          { key: 'capacity', label: 'Capacity', children: event.capacity },
          {
            key: 'price',
            label: 'Price',
            children: `${(event.basePriceMinor / 100).toFixed(2)} ${event.currency}`,
          },
          ...(eventSchema ? toDescriptionRows(eventSchema.fields, event.attributes) : []),
        ]}
      />
      <Form layout="vertical" onFinish={submit} initialValues={{ ticketQuantity: 1 }} style={{ marginTop: 24 }}>
        <Form.Item name="ticketQuantity" label="Tickets" rules={[{ required: true }]}>
          <InputNumber min={1} max={100} />
        </Form.Item>
        {bookingSchema ? toFormItems(bookingSchema.fields) : null}
        <Button type="primary" htmlType="submit" loading={busy} disabled={busy}>
          Book
        </Button>
      </Form>
    </Card>
  );
}
```

Note the max of 100: `CreateBookingSchema` caps `ticketQuantity` at 100.

- [ ] **Step 3: Write the bookings list and detail**

```tsx
// apps/web/app/bookings/page.tsx
'use client';

import Link from 'next/link';
import type { BookingResponse } from '@marketplace/contracts';
import { listBookings } from '../../lib/api/bookings';
import { CursorTable } from '../../components/cursor-table';

export default function BookingsPage() {
  return (
    <CursorTable<BookingResponse>
      rowKey="id"
      load={(cursor) => listBookings(25, cursor)}
      columns={[
        {
          title: 'Booking',
          dataIndex: 'id',
          render: (id: string) => <Link href={`/bookings/${id}`}>{id}</Link>,
        },
        { title: 'Event', dataIndex: 'eventId' },
        { title: 'Status', dataIndex: 'status' },
        { title: 'Tickets', dataIndex: 'ticketQuantity' },
        { title: 'Booked', dataIndex: 'createdAt' },
      ]}
    />
  );
}
```

```tsx
// apps/web/app/bookings/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Spin } from 'antd';
import type { BookingResponse } from '@marketplace/contracts';
import { getBooking } from '../../../lib/api/bookings';
import { toDescriptionRows } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../lib/problem-notify';

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Booking');
  const [booking, setBooking] = useState<BookingResponse | null>(null);

  useEffect(() => {
    getBooking(id).then(setBooking).catch(notifyProblem);
  }, [id]);

  if (!booking) return <Spin />;

  return (
    <Card title={`Booking ${booking.id}`}>
      <Descriptions
        column={1}
        items={[
          { key: 'event', label: 'Event', children: booking.eventId },
          { key: 'status', label: 'Status', children: booking.status },
          { key: 'tickets', label: 'Tickets', children: booking.ticketQuantity },
          { key: 'booked', label: 'Booked', children: booking.createdAt },
          ...(schema ? toDescriptionRows(schema.fields, booking.attributes) : []),
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 4: Write the admin create-event page**

`CreateEventSchema` refines that `endDate` must be after `startDate`, so a violation returns a 400 whose `errors[]` carries `path: 'endDate'` — routing it through `toFormErrors` puts the message on the field instead of in a toast.

```tsx
// apps/web/app/admin/events/new/page.tsx
'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, DatePicker, Form, Input, InputNumber, Select, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { createEvent } from '../../../../lib/api/events';
import { toAttributes, toFormItems } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { notifyProblem, toFormErrors } from '../../../../lib/problem-notify';

export default function NewEventPage() {
  const schema = useSchema('Event');
  const router = useRouter();
  const [form] = Form.useForm();

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createEvent({
        title: values.title as string,
        capacity: values.capacity as number,
        // IsoDateTimeSchema is z.string().datetime(); DatePicker yields Dayjs.
        startDate: (values.startDate as Dayjs).toISOString(),
        endDate: (values.endDate as Dayjs).toISOString(),
        basePriceMinor: values.basePriceMinor as number,
        currency: values.currency as string,
        attributes: schema
          ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
          : {},
      });
      void message.success('Event created');
      router.push(`/events/${created.id}`);
    } catch (err) {
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <Card title="New event" style={{ maxWidth: 640 }}>
      <Form form={form} layout="vertical" onFinish={submit} initialValues={{ currency: 'USD' }}>
        <Form.Item name="title" label="Title" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="capacity" label="Capacity" rules={[{ required: true }]}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="startDate" label="Starts" rules={[{ required: true }]}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="endDate" label="Ends" rules={[{ required: true }]}>
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="basePriceMinor" label="Base price (minor units)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
          <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
        </Form.Item>
        {schema ? toFormItems(schema.fields) : null}
        <Button type="primary" htmlType="submit">
          Create
        </Button>
      </Form>
    </Card>
  );
}
```

- [ ] **Step 5: Verify against the live stack**

As `acme-admin` create an event; as `acme-buyer` book two tickets and confirm the booking detail. Then create an event with `endDate` before `startDate` and confirm the error appears under the `endDate` field, not as a toast.

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): events, bookings and admin event creation"
```

---

### Task 12: Flows — list, detail, execute, and the SQS arrival poll

**Files:**
- Create: `apps/web/app/admin/flows/page.tsx`, `apps/web/app/admin/flows/[id]/page.tsx`
- Create: `apps/web/lib/flows/use-flow-arrival.ts`, `apps/web/lib/flows/use-flow-arrival.test.ts`

**Interfaces:**
- Consumes: `listFlows`, `getFlow`, `executeFlow` (Task 6); `useSchemas().refresh` (Task 8).
- Produces: `useFlowArrival(active: boolean): { waiting: boolean; timedOut: boolean; reloadToken: number }` — polls `listFlows` every 2s for up to 30s and bumps `reloadToken` whenever the newest flow id changes.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/flows/use-flow-arrival.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlowArrival } from './use-flow-arrival';
import * as api from '../api/flows';

describe('useFlowArrival', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops waiting once a new flow appears', async () => {
    const spy = vi
      .spyOn(api, 'listFlows')
      .mockResolvedValueOnce({ items: [], nextCursor: null } as never)
      .mockResolvedValue({ items: [{ id: 'f1' }], nextCursor: null } as never);

    const { result } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.waiting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.waiting).toBe(false);
    expect(result.current.reloadToken).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
  });

  it('gives up after 30 seconds without treating it as an error', async () => {
    vi.spyOn(api, 'listFlows').mockResolvedValue({ items: [], nextCursor: null } as never);

    const { result } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(result.current.waiting).toBe(false);
    expect(result.current.timedOut).toBe(true);
  });

  it('does nothing when inactive', async () => {
    const spy = vi.spyOn(api, 'listFlows');
    const { result } = renderHook(() => useFlowArrival(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.waiting).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- use-flow-arrival`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/lib/flows/use-flow-arrival.ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { listFlows } from '../api/flows';

const INTERVAL_MS = 2000;
const LIMIT_MS = 30_000;

/**
 * Confirming a proposal in chat does not create a Flow -- it puts a
 * PROPOSE_FLOW message on SQS, and the engine's consumer creates the record
 * whenever it gets to it. The client is told nothing when that happens, so the
 * only honest options are polling or a manual refresh.
 *
 * Timing out is not an error: nothing is broken at 30 seconds, the queue is
 * just slow. The caller shows "not here yet -- refresh", not a failure.
 */
export function useFlowArrival(active: boolean) {
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    setWaiting(true);
    setTimedOut(false);
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const { items } = await listFlows(1, null);
        const newest = items[0]?.id ?? null;

        if (baseline.current === null) {
          baseline.current = newest;
        } else if (newest !== baseline.current) {
          baseline.current = newest;
          setWaiting(false);
          setReloadToken((n) => n + 1);
          return;
        }
      } catch {
        // A transient failure mid-poll is not worth surfacing; the next tick
        // or the timeout will resolve it.
      }

      if (Date.now() - startedAt >= LIMIT_MS) {
        setWaiting(false);
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    };

    let timer = setTimeout(() => void tick(), INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);

  return { waiting, timedOut, reloadToken };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- use-flow-arrival`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the flows list**

```tsx
// apps/web/app/admin/flows/page.tsx
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, Space, Tag } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { listFlows } from '../../../lib/api/flows';
import { CursorTable } from '../../../components/cursor-table';
import { useFlowArrival } from '../../../lib/flows/use-flow-arrival';

export default function FlowsPage() {
  // The chat page links here with ?awaiting=<dispatchedMessageId> after a
  // confirm, which is the only signal that something is on the queue.
  const awaiting = useSearchParams().get('awaiting');
  const { waiting, timedOut, reloadToken } = useFlowArrival(Boolean(awaiting));

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {waiting && (
        <Alert
          type="info"
          showIcon
          message="Waiting for the proposal to arrive"
          description="The agent queued it. The engine creates the flow when its consumer picks the message up."
        />
      )}
      {timedOut && (
        <Alert type="warning" showIcon message="Not here yet — refresh to check again" />
      )}
      <CursorTable<FlowResponse>
        rowKey="id"
        reloadToken={reloadToken}
        load={(cursor) => listFlows(25, cursor)}
        columns={[
          {
            title: 'Flow',
            dataIndex: 'id',
            render: (id: string) => <Link href={`/admin/flows/${id}`}>{id}</Link>,
          },
          { title: 'Entity', dataIndex: 'targetEntity' },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (status: string) => (
              <Tag color={status === 'applied' ? 'green' : status === 'rejected' ? 'red' : 'blue'}>
                {status}
              </Tag>
            ),
          },
          {
            title: 'Adds',
            render: (_, row) => row.blueprintDiff.addedFields.map((f) => f.name).join(', '),
          },
          { title: 'Proposed by', dataIndex: 'proposedBy' },
        ]}
      />
    </Space>
  );
}
```

- [ ] **Step 6: Write the flow detail with Execute**

```tsx
// apps/web/app/admin/flows/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Descriptions, Spin, Table, message } from 'antd';
import type { FlowResponse } from '@marketplace/contracts';
import { executeFlow, getFlow } from '../../../../lib/api/flows';
import { useSchemas } from '../../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../../lib/problem-notify';

export default function FlowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { refresh } = useSchemas();
  const [flow, setFlow] = useState<FlowResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFlow(id).then(setFlow).catch(notifyProblem);
  }, [id]);

  if (!flow) return <Spin />;

  const execute = async () => {
    setBusy(true);
    try {
      const applied = await executeFlow(flow.id);
      setFlow(applied);
      // Executing raises the registry version. Re-reading the schema cache is
      // what makes the new field show up in forms and detail pages without a
      // page reload.
      await refresh();
      void message.success(`Applied — registry is now version ${applied.resultingVersion}`);
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={`Flow ${flow.id}`}
      extra={
        flow.status === 'proposed' ? (
          <Button type="primary" loading={busy} onClick={execute}>
            Execute
          </Button>
        ) : null
      }
    >
      <Descriptions
        column={1}
        items={[
          { key: 'entity', label: 'Target entity', children: flow.targetEntity },
          { key: 'status', label: 'Status', children: flow.status },
          { key: 'proposedBy', label: 'Proposed by', children: flow.proposedBy },
          { key: 'executedBy', label: 'Executed by', children: flow.executedBy ?? '—' },
          {
            key: 'version',
            label: 'Resulting version',
            children: flow.resultingVersion ?? '—',
          },
        ]}
      />
      {/* Flows are add-only: actionType is the literal 'ADD_FIELDS' and
          BlueprintDiffSchema is .strict() around addedFields, so there is no
          removal or type change to render. */}
      <Table
        style={{ marginTop: 16 }}
        rowKey="name"
        pagination={false}
        title={() => 'Added fields'}
        dataSource={flow.blueprintDiff.addedFields}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Type', dataIndex: 'type' },
          { title: 'Required', dataIndex: 'required', render: (r: boolean) => (r ? 'yes' : 'no') },
          { title: 'Default', dataIndex: 'default', render: (d: unknown) => String(d ?? '—') },
        ]}
      />
    </Card>
  );
}
```

- [ ] **Step 7: Verify the payoff loop by hand**

With the stack up, as `acme-admin`:
```bash
TOKEN=$(curl -s -X POST http://localhost:3002/api/login -H 'Content-Type: application/json' \
  -d '{"username":"acme-admin","password":"Passw0rd!"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')

curl -s -X POST http://localhost:3000/api/v1/flows \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"targetEntity":"Product","actionType":"ADD_FIELDS","blueprintDiff":{"addedFields":[{"name":"warrantyMonths","type":"number","required":false,"default":null}]}}'
```
Then open `/admin/flows`, execute the flow, and navigate to `/admin/products/new`.
Expected: a `warrantyMonths` number input is present with no page reload and no UI code written for it.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): flow list, execution and the queue-arrival poll"
```

---

### Task 13: Agent chat

**Files:**
- Create: `apps/web/lib/chat/use-agent-socket.ts`, `apps/web/lib/chat/use-agent-socket.test.ts`
- Create: `apps/web/app/admin/chat/page.tsx`

**Interfaces:**
- Consumes: `AGENT_EVENTS`, `AgentStateSnapshotSchema`, `AgentStateSnapshot` from `@marketplace/contracts`; `getToken` (Task 5); `AGENTS_URL` (Task 4).
- Produces: `useAgentSocket(): { snapshot: AgentStateSnapshot | null; connected: boolean; error: string | null; send(content: string): void; confirm(): void; reject(notes?: string): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/chat/use-agent-socket.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const handlers: Record<string, (payload: unknown) => void> = {};
const emit = vi.fn();
const socket = {
  on: (event: string, handler: (payload: unknown) => void) => {
    handlers[event] = handler;
  },
  emit,
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: () => socket }));
vi.mock('../auth/auth-context', () => ({ getToken: () => 'tok' }));

import { useAgentSocket } from './use-agent-socket';

const snapshot = {
  threadId: '01J0000000000000000000000A',
  phase: 'awaiting_confirmation',
  targetEntity: 'Product',
  messages: [{ role: 'assistant', content: 'Add a colour field?' }],
  draftPayload: { addedFields: [{ name: 'colour', type: 'string', required: false, default: null }] },
  missingRequirements: [],
  validationErrors: [],
  dispatchedMessageId: null,
};

describe('useAgentSocket', () => {
  beforeEach(() => {
    sessionStorage.clear();
    emit.mockClear();
  });

  it('starts a thread on connect and stores the threadId', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.connect?.(undefined);
      handlers.state?.(snapshot);
    });

    expect(emit).toHaveBeenCalledWith('thread.start');
    expect(result.current.snapshot?.phase).toBe('awaiting_confirmation');
    expect(sessionStorage.getItem('marketplace.threadId')).toBe(snapshot.threadId);
  });

  it('resumes an existing thread instead of starting a new one', async () => {
    sessionStorage.setItem('marketplace.threadId', snapshot.threadId);
    renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.connect?.(undefined);
    });
    expect(emit).toHaveBeenCalledWith('thread.resume', { threadId: snapshot.threadId });
  });

  it('sends message, confirm and reject with the current threadId', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.connect?.(undefined);
      handlers.state?.(snapshot);
    });

    act(() => result.current.send('add colour'));
    expect(emit).toHaveBeenCalledWith('message', {
      threadId: snapshot.threadId,
      content: 'add colour',
    });

    act(() => result.current.confirm());
    expect(emit).toHaveBeenCalledWith('confirm', { threadId: snapshot.threadId });

    act(() => result.current.reject('no'));
    expect(emit).toHaveBeenCalledWith('reject', { threadId: snapshot.threadId, notes: 'no' });
  });

  it('surfaces an error event as a message', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.error?.({ title: 'Rejected', detail: 'bad thread' });
    });
    expect(result.current.error).toContain('bad thread');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @marketplace/web test -- use-agent-socket`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/lib/chat/use-agent-socket.ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  AGENT_EVENTS,
  AgentStateSnapshotSchema,
  type AgentStateSnapshot,
} from '@marketplace/contracts';
import { AGENTS_URL } from '../env';
import { getToken } from '../auth/auth-context';

const THREAD_KEY = 'marketplace.threadId';

export function useAgentSocket() {
  const [snapshot, setSnapshot] = useState<AgentStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Browsers cannot set headers on a WebSocket upgrade, so the gateway reads
    // the token from the handshake -- see ChatGateway.afterInit.
    const socket = io(`${AGENTS_URL}/agents`, { auth: { token: getToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      const existing = sessionStorage.getItem(THREAD_KEY);
      if (existing) socket.emit(AGENT_EVENTS.threadResume, { threadId: existing });
      else socket.emit(AGENT_EVENTS.threadStart);
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: Error) => setError(err.message));

    socket.on(AGENT_EVENTS.state, (payload: unknown) => {
      // AgentStateSnapshotSchema is deliberately non-strict so an additive
      // server field does not break an older client.
      const parsed = AgentStateSnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        setError('Received a state snapshot this client cannot read');
        return;
      }
      sessionStorage.setItem(THREAD_KEY, parsed.data.threadId);
      setSnapshot(parsed.data);
    });

    socket.on(AGENT_EVENTS.error, (problem: { title?: string; detail?: string }) => {
      setError([problem.title, problem.detail].filter(Boolean).join(': ') || 'agent error');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const threadId = snapshot?.threadId;

  const send = useCallback(
    (content: string) => {
      if (threadId) socketRef.current?.emit(AGENT_EVENTS.message, { threadId, content });
    },
    [threadId],
  );

  const confirm = useCallback(() => {
    if (threadId) socketRef.current?.emit(AGENT_EVENTS.confirm, { threadId });
  }, [threadId]);

  const reject = useCallback(
    (notes?: string) => {
      if (threadId) socketRef.current?.emit(AGENT_EVENTS.reject, { threadId, notes });
    },
    [threadId],
  );

  return { snapshot, connected, error, send, confirm, reject };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/web test -- use-agent-socket`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the chat page**

```tsx
// apps/web/app/admin/chat/page.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Col, Input, List, Row, Space, Table, Tag } from 'antd';
import { useAgentSocket } from '../../../lib/chat/use-agent-socket';

// Every control is derived from `phase`. AgentStateSnapshotSchema's own
// comment: "The client renders from this and nothing else."
const COMPOSING = new Set(['gathering', 'drafting', 'validating']);

export default function ChatPage() {
  const { snapshot, connected, error, send, confirm, reject } = useAgentSocket();
  const [draft, setDraft] = useState('');

  const phase = snapshot?.phase;
  const canCompose = phase !== undefined && COMPOSING.has(phase);
  const canDecide = phase === 'awaiting_confirmation';

  return (
    <Row gutter={24}>
      <Col span={12}>
        <Card title={`Conversation ${connected ? '' : '(connecting…)'}`} data-testid="chat">
          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
          <List
            dataSource={snapshot?.messages ?? []}
            renderItem={(m) => (
              <List.Item>
                <Tag color={m.role === 'user' ? 'blue' : 'green'}>{m.role}</Tag>
                <span data-testid="message">{m.content}</span>
              </List.Item>
            )}
          />
          <Space.Compact style={{ width: '100%', marginTop: 16 }}>
            <Input
              data-testid="composer"
              value={draft}
              disabled={!canCompose}
              maxLength={4000}
              onChange={(e) => setDraft(e.target.value)}
              onPressEnter={() => {
                send(draft);
                setDraft('');
              }}
            />
            <Button
              type="primary"
              disabled={!canCompose || !draft}
              onClick={() => {
                send(draft);
                setDraft('');
              }}
            >
              Send
            </Button>
          </Space.Compact>
        </Card>
      </Col>

      <Col span={12}>
        <Card title="Proposal" extra={phase ? <Tag data-testid="phase">{phase}</Tag> : null}>
          {snapshot?.targetEntity && <p>Target entity: {snapshot.targetEntity}</p>}

          {snapshot?.missingRequirements.length ? (
            <Alert type="warning" message="Still needed" description={snapshot.missingRequirements.join(', ')} />
          ) : null}

          {snapshot?.validationErrors.length ? (
            <Alert type="error" message="Validation errors" description={snapshot.validationErrors.join(', ')} />
          ) : null}

          {snapshot?.draftPayload ? (
            <Table
              style={{ marginTop: 16 }}
              rowKey="name"
              pagination={false}
              dataSource={snapshot.draftPayload.addedFields}
              columns={[
                { title: 'Field', dataIndex: 'name' },
                { title: 'Type', dataIndex: 'type' },
                { title: 'Required', dataIndex: 'required', render: (r: boolean) => (r ? 'yes' : 'no') },
              ]}
            />
          ) : null}

          {canDecide && (
            <Space style={{ marginTop: 16 }}>
              <Button type="primary" data-testid="confirm" onClick={() => confirm()}>
                Confirm
              </Button>
              <Button danger onClick={() => reject()}>
                Reject
              </Button>
            </Space>
          )}

          {phase === 'done' && snapshot?.dispatchedMessageId && (
            <Alert
              style={{ marginTop: 16 }}
              type="success"
              message="Proposal queued"
              description={
                <>
                  The engine records the flow when its consumer reads the message.{' '}
                  <Link href={`/admin/flows?awaiting=${snapshot.dispatchedMessageId}`}>
                    Watch for it on the flows page
                  </Link>
                  .
                </>
              }
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}
```

- [ ] **Step 6: Verify against the live stack**

As `acme-admin` open `/admin/chat` and ask for a new field on Product. Expected: assistant messages appear, the phase tag advances, and at `awaiting_confirmation` the composer disables and Confirm appears. Confirm, follow the link, and watch the waiting banner resolve into a new flow row.

The first message may take a while — `qwen2.5:7b-instruct` runs locally.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): agent chat rendered entirely from the state snapshot"
```

---

### Task 14: Playwright end-to-end suite

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/test/e2e/helpers/session.ts`
- Create: `apps/web/test/e2e/auth.spec.ts`, `catalogue.spec.ts`, `isolation.spec.ts`, `idempotency.spec.ts`, `registry-loop.spec.ts`, `chat.spec.ts`
- Modify: `scripts/e2e.mjs`, `README.md`

**Interfaces:**
- Consumes: every page from Tasks 5, 9–13.
- Produces: `signIn(page, username)` — signs in through the UI and waits for `/products`.

- [ ] **Step 1: Write the config and helper**

```ts
// apps/web/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  // The stack is already up (scripts/e2e.mjs runs docker:up first) and the LLM
  // path is slow, so no webServer here and a generous per-test budget.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:3002', trace: 'retain-on-failure' },
});
```

```ts
// apps/web/test/e2e/helpers/session.ts
import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Passw0rd!';

export async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/products/);
}

/** A product name unique to this run, so repeat runs never collide. */
export const unique = (prefix: string) => `${prefix}-${process.pid}-${Date.now()}`;
```

- [ ] **Step 2: Write the auth and isolation specs**

```ts
// apps/web/test/e2e/auth.spec.ts
import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('signs in and shows the tenant and role', async ({ page }) => {
  await signIn(page, 'acme-admin');
  await expect(page.getByText('acme')).toBeVisible();
  await expect(page.getByText('admin')).toBeVisible();
});

test('a buyer sees no admin navigation', async ({ page }) => {
  await signIn(page, 'acme-buyer');
  await expect(page.getByRole('link', { name: 'Flows' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
});
```

```ts
// apps/web/test/e2e/isolation.spec.ts
import { expect, test } from '@playwright/test';
import { signIn, unique } from './helpers/session';

test('one tenant cannot see another tenant\'s product', async ({ page }) => {
  const name = unique('isolation-widget');

  await signIn(page, 'acme-admin');
  await page.goto('/admin/products/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('acme only');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price (minor units)').fill('1000');
  await page.getByLabel('Stock').fill('5');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]+/);
  const acmeUrl = page.url();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'globex-admin');

  await expect(page.getByText(name)).toHaveCount(0);

  // Typing the id by hand must not work either -- isolation is enforced by the
  // engine on every route, not by hiding links.
  await page.goto(acmeUrl);
  await expect(page.getByText(name)).toHaveCount(0);
});
```

- [ ] **Step 3: Write the catalogue and idempotency specs**

```ts
// apps/web/test/e2e/idempotency.spec.ts
import { expect, test } from '@playwright/test';
import { signIn, unique } from './helpers/session';

test('a double-submitted checkout creates exactly one order', async ({ page }) => {
  const name = unique('idem-widget');

  await signIn(page, 'acme-admin');
  await page.goto('/admin/products/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('for idempotency');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price (minor units)').fill('2500');
  await page.getByLabel('Stock').fill('10');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]+/);

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/cart');
  await page.getByLabel('Address').fill('1 Test Street');
  await page.getByLabel('City').fill('Testville');
  await page.getByLabel('Postcode').fill('TE5 7XX');

  const before = await page.goto('/orders').then(() => page.locator('tbody tr').count());
  await page.goto('/cart');

  // Two clicks in the same tick: the button disables, but correctness comes
  // from the idempotency key, not the disable.
  const button = page.getByRole('button', { name: 'Place order' });
  await Promise.all([button.click(), button.click().catch(() => {})]);

  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]+/);
  await page.goto('/orders');
  await expect(page.locator('tbody tr')).toHaveCount(before + 1);
});
```

```ts
// apps/web/test/e2e/catalogue.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { signIn, unique } from './helpers/session';

async function createProduct(page: Page, name: string, priceMinor: number): Promise<void> {
  await page.goto('/admin/products/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('catalogue fixture');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price (minor units)').fill(String(priceMinor));
  await page.getByLabel('Stock').fill('20');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]+/);
}

test('an order can be placed for two products found through the catalogue', async ({ page }) => {
  const cheap = unique('cheap-widget');
  const dear = unique('dear-widget');

  await signIn(page, 'acme-admin');
  await createProduct(page, cheap, 500);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await createProduct(page, dear, 9500);
  await page.getByRole('button', { name: 'Add to cart' }).click();

  // The price filter narrows to the dear one only, proving POST
  // /products/search is wired up rather than the unfiltered list.
  await page.goto('/products');
  await page.getByLabel('Min price (minor)').fill('9000');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(dear)).toBeVisible();
  await expect(page.getByText(cheap)).toHaveCount(0);

  await page.goto('/cart');
  await page.getByLabel('Address').fill('1 Test Street');
  await page.getByLabel('City').fill('Testville');
  await page.getByLabel('Postcode').fill('TE5 7XX');
  await page.getByRole('button', { name: 'Place order' }).click();

  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]+/);
  // Two line items, each with the unit price locked at order time.
  await expect(page.locator('tbody tr')).toHaveCount(2);
});
```

- [ ] **Step 4: Write the deterministic registry-loop spec (7a)**

This is the assertion that proves the field engine, and it never touches the model.

```ts
// apps/web/test/e2e/registry-loop.spec.ts
import { expect, test, request as playwrightRequest } from '@playwright/test';
import { signIn, PASSWORD } from './helpers/session';

test('executing a flow makes its new field appear in the product form', async ({ page }) => {
  const fieldName = `warranty${Date.now()}`;

  // Propose the flow directly with a known diff. The chat path is covered
  // separately and loosely, because an LLM will not produce the same diff
  // twice and asserting on generated names would manufacture flake.
  const api = await playwrightRequest.newContext();
  const login = await api.post('http://localhost:3002/api/login', {
    data: { username: 'acme-admin', password: PASSWORD },
  });
  const { token } = (await login.json()) as { token: string };

  const created = await api.post('http://localhost:3000/api/v1/flows', {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      targetEntity: 'Product',
      actionType: 'ADD_FIELDS',
      blueprintDiff: {
        addedFields: [{ name: fieldName, type: 'number', required: false, default: null }],
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  const flow = (await created.json()) as { id: string };

  await signIn(page, 'acme-admin');
  await page.goto(`/admin/flows/${flow.id}`);
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.getByText(/Applied/)).toBeVisible();

  await page.goto('/admin/products/new');
  await expect(page.getByLabel(fieldName)).toBeVisible();

  await page.goto('/products');
  await expect(page.getByLabel(fieldName)).toBeVisible();
});
```

- [ ] **Step 5: Write the loose chat spec (7b)**

```ts
// apps/web/test/e2e/chat.spec.ts
import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

// Asserts the socket, the graph and the phase machine -- nothing about the
// model's word choices. qwen2.5:7b-instruct runs locally and is slow.
test('a conversation reaches awaiting_confirmation with a draft', async ({ page }) => {
  test.slow();

  await signIn(page, 'acme-admin');
  await page.goto('/admin/chat');

  await page.getByTestId('composer').fill('Add a required text field called colour to Product');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('phase')).toHaveText('awaiting_confirmation', { timeout: 90_000 });
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  await expect(page.getByTestId('composer')).toBeDisabled();

  await page.getByTestId('confirm').click();
  await expect(page.getByText('Proposal queued')).toBeVisible({ timeout: 60_000 });
});
```

- [ ] **Step 6: Wire the suite into `scripts/e2e.mjs`**

```js
// scripts/e2e.mjs — after the agents suite, before the docker:down teardown
if (code === 0) {
  code = run('pnpm', ['--filter', '@marketplace/web', 'test:e2e']);
}
```

- [ ] **Step 7: Run the whole suite**

Run: `pnpm --filter @marketplace/web exec playwright install chromium`
Then: `pnpm e2e`
Expected: engine, agents and web suites all pass, and the stack is torn down with `ollama-models` intact.

If `chat.spec.ts` times out, confirm the model is pulled: `curl -s http://localhost:11434/api/tags`. A cold first pull takes several minutes and is not a test failure.

- [ ] **Step 8: Document the app in the README**

Add `apps/web` to the layout table, note `web` in the `docker:up` service list, record that the console is at `http://localhost:3002` with the three demo personas and the shared dev password, and add `npx playwright install chromium` as a one-time setup step next to `pnpm install`.

- [ ] **Step 9: Commit**

```bash
git add apps/web scripts/e2e.mjs README.md
git commit -m "test(web): end-to-end coverage for auth, catalogue, isolation, idempotency and the registry loop"
```

---

## Verification

Full-stack check, from clean:

```bash
pnpm install
pnpm --filter @marketplace/web exec playwright install chromium
pnpm docker:down
pnpm e2e
```

Expected: contracts, engine, agents and web unit suites pass; all three e2e suites pass; no "worker process has failed to exit gracefully" warning; `docker volume ls` still lists `marketplace_ollama-models`.

Manual check of the thing the app exists to demonstrate:

1. `pnpm docker:up`, open `http://localhost:3002`, sign in as `acme-admin`.
2. `/admin/chat` — ask for a new field on Product. Watch the phase reach `awaiting_confirmation`, then Confirm.
3. Follow the link to `/admin/flows`, wait for the banner to resolve, open the flow, Execute.
4. `/admin/products/new` — the new field is in the form, with no reload and no UI code written for it.
5. Create a product using it, then find it at `/products` by filtering on that field.
6. Sign out, sign in as `globex-admin`, and confirm none of it is visible.
