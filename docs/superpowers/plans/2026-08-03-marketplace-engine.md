# MarketplaceEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic MarketplaceEngine service — multi-tenant DynamoDB CRUD for products, orders, events and bookings, with an enforcing per-tenant dynamic schema registry — running and verified entirely in local Docker Compose.

**Architecture:** pnpm monorepo. `packages/contracts` holds Zod schemas that are the single source of truth for entity shapes; TypeScript types are inferred from them. `apps/engine` is a NestJS app with five feature modules (products, events, orders, bookings, flows) sitting on three shared primitives: `DynamoRepository` (the only code that builds a partition key or calls DynamoDB), `SchemaRegistryService` (per-tenant field definitions, cached in Redis), and an `AsyncLocalStorage`-based `TenantContext`. Tenant identity comes exclusively from a verified JWT claim, which makes cross-tenant access structurally inexpressible.

**Tech Stack:** Node 22, pnpm 9, Turborepo, TypeScript 5.6, NestJS 11, Zod 3, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-sqs`, `jose` (JWT/JWKS), `ioredis`, `ulid`, `nestjs-pino`, Jest 29 + Supertest. Local infrastructure: `amazon/dynamodb-local`, `localstack` (SQS only), `redis:7`, `jagregory/cognito-local`.

**Spec:** `docs/superpowers/specs/2026-08-03-marketplace-engine-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 22, pnpm 9.** All packages are private, versioned `0.0.0`, and linked with `workspace:*`.
- **Docker-first.** A feature is not done until it passes against the real containers in `docker/docker-compose.yml`. No feature may be verified only against mocks.
- **No code branches on environment.** Local and AWS differ by configuration only — endpoint and JWKS URLs come from env vars. Never write `if (process.env.NODE_ENV === 'production')` around infrastructure wiring.
- **Tenant identity comes only from the `custom:tenant_id` JWT claim.** Never from a body, path, query, or header. `DynamoRepository` is the only module allowed to construct a `PK`, and its public methods take no tenant argument.
- **Money is integer minor units.** `priceMinor`, `unitPriceMinor`, `totalAmountMinor`, `basePriceMinor`, all `z.number().int().nonnegative()`, each accompanied by an ISO-4217 `currency` string. No floats for money anywhere.
- **Identifiers are ULIDs** (26 chars, Crockford base32), never UUIDv4.
- **Errors are RFC 9457 `application/problem+json`** and always carry a `traceId`.
- **TDD.** Write the failing test, run it, watch it fail for the right reason, implement minimally, run it green, commit.
- **Commit messages carry no `Co-Authored-By` trailer and no tool attribution.** Conventional Commits prefix (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).
- **Table name** is `MarketplaceEngine`. **Queue name** is `marketplace-engine-jobs.fifo`.
- **Dynamic field types** allowed in the registry: `string`, `number`, `boolean`, `date`, and the array forms `string[]`, `number[]`, `boolean[]`, `date[]`. No nested objects.

## File Structure

```
marketplace/
├─ package.json                        root scripts, turbo, workspace deps
├─ pnpm-workspace.yaml
├─ turbo.json
├─ tsconfig.base.json
├─ scripts/e2e.mjs                     cross-platform up → test → down with correct exit code
├─ docker/
│  ├─ docker-compose.yml               dynamodb-local, localstack, redis, cognito-local, seed, engine
│  ├─ .env.generated                   written by seed; git-ignored
│  └─ seed/
│     ├─ package.json
│     ├─ seed.ts                       entrypoint: table + queue + cognito pool
│     ├─ dynamo.ts                     CreateTable with GSI1
│     ├─ sqs.ts                        FIFO queue + DLQ + redrive policy
│     └─ cognito.ts                    idempotent user pool + app client
├─ packages/contracts/src/
│  ├─ index.ts                         re-exports
│  ├─ common.ts                        Ulid, Currency, MinorAmount, IsoDateTime, Page
│  ├─ registry.ts                      FieldType, FieldDefinition, EntitySchemaRecord
│  ├─ product.ts                       ProductStatus, CreateProduct, SearchProducts, ProductRecord
│  ├─ order.ts                         OrderStatus, CreateOrder, OrderRecord
│  ├─ event.ts                         CreateEvent, EventRecord
│  ├─ booking.ts                       BookingStatus, CreateBooking, BookingRecord
│  ├─ flow.ts                          FlowStatus, BlueprintDiff, CreateFlow, FlowRecord
│  └─ sqs.ts                           EngineJobMessage
└─ apps/engine/src/
   ├─ main.ts                          bootstrap, global pipe/filter/prefix
   ├─ app.module.ts
   ├─ config/                          env.schema.ts, config.module.ts
   ├─ common/                          tenant-context.ts, zod-validation.pipe.ts,
   │                                   problem.ts, problem.filter.ts, cursor.ts, ids.ts
   ├─ auth/                            jwt-verifier.ts, jwt-auth.guard.ts, auth.module.ts
   ├─ persistence/                     keys.ts, dynamo.client.ts, dynamo.repository.ts
   ├─ registry/                        attribute-validator.ts, schema-registry.service.ts
   ├─ idempotency/                     redis.client.ts, idempotency.service.ts, .interceptor.ts
   ├─ products/  events/  orders/  bookings/  flows/
   ├─ messaging/                       sqs-consumer.service.ts
   └─ health/                          health.controller.ts
```

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.npmrc`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/jest.config.js`, `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/index.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: workspace package `@marketplace/contracts`; root scripts `pnpm build`, `pnpm test`.

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/index.test.ts`:

```ts
import { PACKAGE_NAME } from './index';

describe('contracts package', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE_NAME).toBe('@marketplace/contracts');
  });
});
```

- [ ] **Step 2: Create the workspace files**

`pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'docker/seed'
```

`.npmrc`:

```
auto-install-peers=true
strict-peer-dependencies=false
```

Root `package.json`:

```json
{
  "name": "marketplace",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "docker:up": "docker compose -f docker/docker-compose.yml up -d --wait",
    "docker:down": "docker compose -f docker/docker-compose.yml down -v",
    "e2e": "node scripts/e2e.mjs"
  },
  "devDependencies": {
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "turbo": "^2.1.0",
    "typescript": "^5.6.0"
  }
}
```

`turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "test:e2e": { "cache": false }
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`packages/contracts/package.json`:

```json
{
  "name": "@marketplace/contracts",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": {
    "@types/jest": "^29.5.13",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  }
}
```

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/contracts/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
};
```

`packages/contracts/src/index.ts`:

```ts
export const PACKAGE_NAME = '@marketplace/contracts';
```

Append to `.gitignore`:

```
docker/.env.generated
.cognito/
```

- [ ] **Step 3: Install and run the test**

Run: `pnpm install && pnpm test`
Expected: PASS, one test in `@marketplace/contracts`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo with contracts package"
```

---

### Task 2: Contract schemas

**Files:**
- Create: `packages/contracts/src/common.ts`, `registry.ts`, `product.ts`, `order.ts`, `event.ts`, `booking.ts`, `flow.ts`, `sqs.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/product.test.ts`, `flow.test.ts`, `sqs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: every schema and type used by the rest of the plan —
  `UlidSchema`, `CurrencySchema`, `MinorAmountSchema`, `IsoDateTimeSchema`;
  `FieldTypeSchema`, `FieldDefinition`, `EntitySchemaRecord`, `DynamicEntityType`;
  `CreateProductSchema`, `SearchProductsSchema`, `ProductRecord`, `ProductStatus`;
  `CreateOrderSchema`, `OrderRecord`, `OrderStatus`;
  `CreateEventSchema`, `EventRecord`;
  `CreateBookingSchema`, `BookingRecord`, `BookingStatus`;
  `BlueprintDiffSchema`, `CreateFlowSchema`, `FlowRecord`, `FlowStatus`;
  `EngineJobMessageSchema`, `EngineJobMessage`.

- [ ] **Step 1: Write the failing tests**

`packages/contracts/src/product.test.ts`:

```ts
import { CreateProductSchema } from './product';

const valid = {
  name: 'Chair',
  description: 'A chair',
  priceMinor: 4999,
  currency: 'INR',
  category: 'furniture',
  stock: 10,
};

describe('CreateProductSchema', () => {
  it('accepts a valid product and applies defaults', () => {
    const parsed = CreateProductSchema.parse(valid);
    expect(parsed.status).toBe('draft');
    expect(parsed.images).toEqual([]);
    expect(parsed.attributes).toEqual({});
  });

  it('rejects fractional money', () => {
    expect(() => CreateProductSchema.parse({ ...valid, priceMinor: 49.99 })).toThrow();
  });

  it('rejects a non ISO-4217 currency', () => {
    expect(() => CreateProductSchema.parse({ ...valid, currency: 'rupees' })).toThrow();
  });

  it('rejects negative stock', () => {
    expect(() => CreateProductSchema.parse({ ...valid, stock: -1 })).toThrow();
  });
});
```

`packages/contracts/src/flow.test.ts`:

```ts
import { BlueprintDiffSchema, CreateFlowSchema } from './flow';

describe('BlueprintDiffSchema', () => {
  it('accepts an add-fields diff', () => {
    const parsed = BlueprintDiffSchema.parse({
      addedFields: [{ name: 'dietaryNeeds', type: 'string' }],
    });
    expect(parsed.addedFields[0].required).toBe(false);
    expect(parsed.addedFields[0].default).toBeNull();
  });

  it('rejects a destructive diff', () => {
    expect(() =>
      BlueprintDiffSchema.parse({ addedFields: [], removedFields: ['price'] }),
    ).toThrow();
  });

  it('rejects an empty diff', () => {
    expect(() => BlueprintDiffSchema.parse({ addedFields: [] })).toThrow();
  });

  it('rejects a field name that is not an identifier', () => {
    expect(() =>
      BlueprintDiffSchema.parse({ addedFields: [{ name: '2bad', type: 'string' }] }),
    ).toThrow();
  });
});

describe('CreateFlowSchema', () => {
  it('rejects an unsupported action type', () => {
    expect(() =>
      CreateFlowSchema.parse({
        targetEntity: 'Product',
        actionType: 'REMOVE_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string' }] },
      }),
    ).toThrow();
  });
});
```

`packages/contracts/src/sqs.test.ts`:

```ts
import { EngineJobMessageSchema } from './sqs';

describe('EngineJobMessageSchema', () => {
  it('parses the PRD message body verbatim', () => {
    const parsed = EngineJobMessageSchema.parse({
      action: 'PROPOSE_FLOW',
      targetEntity: 'Event',
      tenantId: 'TENANT#client_123',
      payload: { addedFields: [{ name: 'dietaryNeeds', type: 'string' }] },
      metadata: { threadId: 'thread_88291' },
    });
    expect(parsed.payload.addedFields).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @marketplace/contracts test`
Expected: FAIL — `Cannot find module './product'`.

- [ ] **Step 3: Implement the schemas**

`packages/contracts/src/common.ts`:

```ts
import { z } from 'zod';

export const UlidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID');
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO-4217 code');
export const MinorAmountSchema = z.number().int().nonnegative();
export const IsoDateTimeSchema = z.string().datetime();
export const AttributesSchema = z.record(z.string(), z.unknown());

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

`packages/contracts/src/registry.ts`:

```ts
import { z } from 'zod';

export const FieldTypeSchema = z.enum([
  'string', 'number', 'boolean', 'date',
  'string[]', 'number[]', 'boolean[]', 'date[]',
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

export const FieldNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'must be an identifier');

export const FieldDefinitionSchema = z.object({
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  default: z.unknown().nullable().default(null),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

export const EntitySchemaRecordSchema = z.object({
  version: z.number().int().nonnegative(),
  fields: z.record(FieldNameSchema, FieldDefinitionSchema),
});
export type EntitySchemaRecord = z.infer<typeof EntitySchemaRecordSchema>;

export const DynamicEntityTypeSchema = z.enum(['Product', 'Order', 'Event', 'Booking']);
export type DynamicEntityType = z.infer<typeof DynamicEntityTypeSchema>;
```

`packages/contracts/src/product.ts`:

```ts
import { z } from 'zod';
import { AttributesSchema, CurrencySchema, MinorAmountSchema } from './common';

export const ProductStatusSchema = z.enum(['active', 'draft', 'archived', 'out_of_stock']);
export type ProductStatus = z.infer<typeof ProductStatusSchema>;

export const CreateProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000),
  priceMinor: MinorAmountSchema,
  currency: CurrencySchema,
  category: z.string().min(1).max(100),
  stock: z.number().int().nonnegative(),
  images: z.array(z.string().url()).max(20).default([]),
  status: ProductStatusSchema.default('draft'),
  attributes: AttributesSchema.default({}),
});
export type CreateProduct = z.infer<typeof CreateProductSchema>;

export const SearchProductsSchema = z.object({
  category: z.string().optional(),
  status: ProductStatusSchema.optional(),
  priceMinorMin: MinorAmountSchema.optional(),
  priceMinorMax: MinorAmountSchema.optional(),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().nullable().default(null),
});
export type SearchProducts = z.infer<typeof SearchProductsSchema>;

export interface ProductRecord {
  PK: string;
  SK: string;
  entityType: 'Product';
  id: string;
  status: ProductStatus;
  name: string;
  description: string;
  priceMinor: number;
  currency: string;
  category: string;
  stock: number;
  images: string[];
  createdAt: string;
  updatedAt: string;
  attributes: Record<string, unknown>;
}
```

`packages/contracts/src/order.ts`:

```ts
import { z } from 'zod';
import { AttributesSchema, CurrencySchema, UlidSchema } from './common';

export const OrderStatusSchema = z.enum(['pending', 'confirmed', 'cancelled']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const MAX_ORDER_LINE_ITEMS = 50;

export const CreateOrderSchema = z.object({
  items: z
    .array(z.object({ productId: UlidSchema, quantity: z.number().int().positive() }))
    .min(1),
  currency: CurrencySchema,
  shippingAddress: z.record(z.string(), z.string()),
  attributes: AttributesSchema.default({}),
});
export type CreateOrder = z.infer<typeof CreateOrderSchema>;

export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPriceMinor: number;
}

export interface OrderRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'Order';
  id: string;
  userId: string;
  status: OrderStatus;
  totalAmountMinor: number;
  currency: string;
  items: OrderLineItem[];
  shippingAddress: Record<string, string>;
  createdAt: string;
  attributes: Record<string, unknown>;
}
```

Note the line-item cap is **not** enforced by Zod — it is enforced in the orders service so the failure surfaces as a `too-many-line-items` problem rather than a generic validation error.

`packages/contracts/src/event.ts`:

```ts
import { z } from 'zod';
import { AttributesSchema, CurrencySchema, IsoDateTimeSchema, MinorAmountSchema } from './common';

export const CreateEventSchema = z
  .object({
    title: z.string().min(1).max(200),
    capacity: z.number().int().positive(),
    startDate: IsoDateTimeSchema,
    endDate: IsoDateTimeSchema,
    basePriceMinor: MinorAmountSchema,
    currency: CurrencySchema,
    attributes: AttributesSchema.default({}),
  })
  .refine((e) => Date.parse(e.endDate) > Date.parse(e.startDate), {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });
export type CreateEvent = z.infer<typeof CreateEventSchema>;

export interface EventRecord {
  PK: string;
  SK: string;
  entityType: 'Event';
  id: string;
  title: string;
  capacity: number;
  bookedCount: number;
  startDate: string;
  endDate: string;
  basePriceMinor: number;
  currency: string;
  createdAt: string;
  attributes: Record<string, unknown>;
}
```

`packages/contracts/src/booking.ts`:

```ts
import { z } from 'zod';
import { AttributesSchema, UlidSchema } from './common';

export const BookingStatusSchema = z.enum(['confirmed', 'cancelled']);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

export const CreateBookingSchema = z.object({
  eventId: UlidSchema,
  ticketQuantity: z.number().int().positive().max(100),
  attributes: AttributesSchema.default({}),
});
export type CreateBooking = z.infer<typeof CreateBookingSchema>;

export interface BookingRecord {
  PK: string;
  SK: string;
  GSI1PK: string;
  GSI1SK: string;
  entityType: 'Booking';
  id: string;
  eventId: string;
  userId: string;
  status: BookingStatus;
  ticketQuantity: number;
  createdAt: string;
  attributes: Record<string, unknown>;
}
```

`packages/contracts/src/flow.ts`:

```ts
import { z } from 'zod';
import { DynamicEntityTypeSchema, FieldNameSchema, FieldTypeSchema } from './registry';

export const FlowStatusSchema = z.enum(['proposed', 'applied', 'rejected']);
export type FlowStatus = z.infer<typeof FlowStatusSchema>;

export const AddedFieldSchema = z.object({
  name: FieldNameSchema,
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  default: z.unknown().nullable().default(null),
});
export type AddedField = z.infer<typeof AddedFieldSchema>;

// .strict() is what makes this add-only: `removedFields` or `changedFields`
// are unrecognized keys and are rejected.
export const BlueprintDiffSchema = z
  .object({ addedFields: z.array(AddedFieldSchema).min(1) })
  .strict();
export type BlueprintDiff = z.infer<typeof BlueprintDiffSchema>;

export const CreateFlowSchema = z.object({
  targetEntity: DynamicEntityTypeSchema,
  actionType: z.literal('ADD_FIELDS'),
  blueprintDiff: BlueprintDiffSchema,
});
export type CreateFlow = z.infer<typeof CreateFlowSchema>;

export interface FlowRecord {
  PK: string;
  SK: string;
  entityType: 'Flow';
  id: string;
  targetEntity: string;
  actionType: 'ADD_FIELDS';
  status: FlowStatus;
  blueprintDiff: BlueprintDiff;
  createdAt: string;
  appliedAt: string | null;
  resultingVersion: number | null;
}
```

`packages/contracts/src/sqs.ts`:

```ts
import { z } from 'zod';
import { BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';

export const EngineJobMessageSchema = z.object({
  action: z.literal('PROPOSE_FLOW'),
  targetEntity: DynamicEntityTypeSchema,
  tenantId: z.string().min(1),
  payload: BlueprintDiffSchema,
  metadata: z.object({ threadId: z.string() }).passthrough(),
});
export type EngineJobMessage = z.infer<typeof EngineJobMessageSchema>;
```

`packages/contracts/src/index.ts`:

```ts
export const PACKAGE_NAME = '@marketplace/contracts';
export * from './common';
export * from './registry';
export * from './product';
export * from './order';
export * from './event';
export * from './booking';
export * from './flow';
export * from './sqs';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/contracts test`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add entity, registry and SQS contract schemas"
```

---

### Task 3: Docker Compose stack and seeding

**Files:**
- Create: `docker/docker-compose.yml`
- Create: `docker/seed/package.json`, `docker/seed/tsconfig.json`, `docker/seed/seed.ts`, `docker/seed/dynamo.ts`, `docker/seed/sqs.ts`, `docker/seed/cognito.ts`
- Create: `scripts/e2e.mjs`
- Test: `docker/seed/verify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a running stack; `docker/.env.generated` containing `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `JWT_ISSUER`, `JWKS_URI`, `QUEUE_URL`, `DLQ_URL`.

The seed container runs to completion before the engine container starts, which is how the engine gets a Cognito pool id that Cognito generates at runtime. This avoids hand-authoring `cognito-local`'s internal database files.

- [ ] **Step 1: Write the failing verification test**

`docker/seed/verify.test.ts`:

```ts
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { SQSClient, GetQueueAttributesCommand } from '@aws-sdk/client-sqs';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '../.env.generated'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);

const creds = { accessKeyId: 'local', secretAccessKey: 'local' };

describe('seeded infrastructure', () => {
  it('creates the MarketplaceEngine table with GSI1', async () => {
    const ddb = new DynamoDBClient({ region: 'us-east-1', endpoint: 'http://localhost:8000', credentials: creds });
    const out = await ddb.send(new DescribeTableCommand({ TableName: 'MarketplaceEngine' }));
    expect(out.Table?.TableStatus).toBe('ACTIVE');
    expect(out.Table?.GlobalSecondaryIndexes?.[0]?.IndexName).toBe('GSI1');
  });

  it('creates the FIFO queue with a redrive policy', async () => {
    const sqs = new SQSClient({ region: 'us-east-1', endpoint: 'http://localhost:4566', credentials: creds });
    const out = await sqs.send(
      new GetQueueAttributesCommand({ QueueUrl: env.QUEUE_URL, AttributeNames: ['FifoQueue', 'RedrivePolicy'] }),
    );
    expect(out.Attributes?.FifoQueue).toBe('true');
    expect(out.Attributes?.RedrivePolicy).toContain('maxReceiveCount');
  });

  it('creates a Cognito user pool reachable over JWKS', async () => {
    const res = await fetch(env.JWKS_URI.replace('cognito-local', 'localhost'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[] };
    expect(body.keys.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write the compose file and seed scripts**

`docker/docker-compose.yml`:

```yaml
name: marketplace

services:
  dynamodb-local:
    image: amazon/dynamodb-local:2.5.2
    command: ['-jar', 'DynamoDBLocal.jar', '-inMemory', '-sharedDb']
    ports: ['8000:8000']
    healthcheck:
      test: ['CMD-SHELL', 'curl -s -o /dev/null http://localhost:8000 || exit 1']
      interval: 3s
      retries: 20

  localstack:
    image: localstack/localstack:3.8
    environment:
      SERVICES: sqs
      AWS_DEFAULT_REGION: us-east-1
    ports: ['4566:4566']
    healthcheck:
      test: ['CMD-SHELL', 'curl -s http://localhost:4566/_localstack/health | grep -q "\"sqs\": \"available\""']
      interval: 3s
      retries: 30

  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 3s
      retries: 20

  cognito-local:
    image: jagregory/cognito-local:3.21.0
    ports: ['9229:9229']
    volumes: ['cognito-data:/app/.cognito']
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:9229/health || exit 0']
      interval: 3s
      retries: 20

  seed:
    build: { context: .., dockerfile: docker/seed/Dockerfile }
    working_dir: /repo/docker/seed
    command: ['node', '--import', 'tsx', 'seed.ts']
    environment:
      DYNAMODB_ENDPOINT: http://dynamodb-local:8000
      SQS_ENDPOINT: http://localstack:4566
      COGNITO_ENDPOINT: http://cognito-local:9229
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
      ENV_OUT: /repo/docker/.env.generated
    volumes: ['..:/repo']
    depends_on:
      dynamodb-local: { condition: service_healthy }
      localstack: { condition: service_healthy }
      cognito-local: { condition: service_started }

volumes:
  cognito-data:
```

The `engine` service is added in Task 4, once there is an application to run.

`docker/seed/package.json`:

```json
{
  "name": "@marketplace/seed",
  "version": "0.0.0",
  "private": true,
  "scripts": { "test": "jest", "build": "tsc -p tsconfig.json --noEmit" },
  "dependencies": {
    "@aws-sdk/client-cognito-identity-provider": "^3.665.0",
    "@aws-sdk/client-dynamodb": "^3.665.0",
    "@aws-sdk/client-sqs": "^3.665.0",
    "tsx": "^4.19.1"
  },
  "devDependencies": {
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  }
}
```

`docker/seed/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: '.*\\.test\\.ts$',
  testTimeout: 30000,
};
```

`docker/seed/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": ".", "noEmit": true },
  "include": ["**/*.ts"]
}
```

pnpm isolates `node_modules` per package, so each workspace package declares its own test tooling rather than relying on the root's.

`docker/seed/Dockerfile`:

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
```

`docker/seed/dynamo.ts`:

```ts
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';

export const TABLE_NAME = 'MarketplaceEngine';

export async function ensureTable(): Promise<void> {
  const ddb = new DynamoDBClient({ endpoint: process.env.DYNAMODB_ENDPOINT });
  try {
    await ddb.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    console.log(`table ${TABLE_NAME} already exists`);
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  await ddb.send(
    new CreateTableCommand({
      TableName: TABLE_NAME,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  console.log(`created table ${TABLE_NAME}`);
}
```

`docker/seed/sqs.ts`:

```ts
import { SQSClient, CreateQueueCommand, GetQueueAttributesCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs';

export async function ensureQueues(): Promise<{ queueUrl: string; dlqUrl: string }> {
  const sqs = new SQSClient({ endpoint: process.env.SQS_ENDPOINT });

  const dlq = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'marketplace-engine-jobs-dlq.fifo',
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
    }),
  );
  const dlqUrl = dlq.QueueUrl!;

  const dlqArn = (
    await sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlqUrl, AttributeNames: ['QueueArn'] }))
  ).Attributes!.QueueArn!;

  const main = await sqs.send(
    new CreateQueueCommand({
      QueueName: 'marketplace-engine-jobs.fifo',
      Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'true' },
    }),
  );
  const queueUrl = main.QueueUrl!;

  await sqs.send(
    new SetQueueAttributesCommand({
      QueueUrl: queueUrl,
      Attributes: {
        RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlqArn, maxReceiveCount: 5 }),
        VisibilityTimeout: '30',
      },
    }),
  );

  return { queueUrl, dlqUrl };
}
```

`docker/seed/cognito.ts`:

```ts
import {
  CognitoIdentityProviderClient,
  CreateUserPoolCommand,
  CreateUserPoolClientCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const POOL_NAME = 'marketplace';
const CLIENT_NAME = 'marketplace-engine';

export async function ensureUserPool(): Promise<{ userPoolId: string; clientId: string }> {
  const cognito = new CognitoIdentityProviderClient({ endpoint: process.env.COGNITO_ENDPOINT });

  const pools = await cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  let userPoolId = pools.UserPools?.find((p) => p.Name === POOL_NAME)?.Id;

  if (!userPoolId) {
    const created = await cognito.send(
      new CreateUserPoolCommand({
        PoolName: POOL_NAME,
        Schema: [{ Name: 'tenant_id', AttributeDataType: 'String', Mutable: true }],
      }),
    );
    userPoolId = created.UserPool!.Id!;
  }

  const clients = await cognito.send(
    new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 }),
  );
  let clientId = clients.UserPoolClients?.find((c) => c.ClientName === CLIENT_NAME)?.ClientId;

  if (!clientId) {
    const created = await cognito.send(
      new CreateUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientName: CLIENT_NAME,
        ExplicitAuthFlows: ['ADMIN_NO_SRP_AUTH', 'USER_PASSWORD_AUTH'],
      }),
    );
    clientId = created.UserPoolClient!.ClientId!;
  }

  return { userPoolId, clientId };
}
```

`docker/seed/seed.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { ensureTable } from './dynamo';
import { ensureQueues } from './sqs';
import { ensureUserPool } from './cognito';

async function main(): Promise<void> {
  await ensureTable();
  const { queueUrl, dlqUrl } = await ensureQueues();
  const { userPoolId, clientId } = await ensureUserPool();

  // The issuer and the JWKS URI deliberately use different hosts locally.
  //
  // Tokens are minted by the e2e suite running on the host, so cognito-local
  // stamps `iss` with the host-facing origin. Issuer checking is a string
  // comparison and never a network call, so JWT_ISSUER must match that.
  // Fetching the JWKS *is* a network call made from inside the engine
  // container, so JWKS_URI must use the compose service name.
  //
  // Against real Cognito both values share one host; this asymmetry lives
  // entirely in configuration, so no code branches on environment.
  const hostOrigin = process.env.COGNITO_HOST_ORIGIN ?? 'http://localhost:9229';
  const internalOrigin = process.env.COGNITO_ENDPOINT!;

  const lines = [
    `COGNITO_USER_POOL_ID=${userPoolId}`,
    `COGNITO_CLIENT_ID=${clientId}`,
    `COGNITO_ENDPOINT_HOST=${hostOrigin}`,
    `JWT_ISSUER=${hostOrigin}/${userPoolId}`,
    `JWT_AUDIENCE=${clientId}`,
    `JWKS_URI=${internalOrigin}/${userPoolId}/.well-known/jwks.json`,
    `QUEUE_URL=${queueUrl}`,
    `DLQ_URL=${dlqUrl}`,
    '',
  ];
  writeFileSync(process.env.ENV_OUT!, lines.join('\n'), 'utf8');
  console.log(`wrote ${process.env.ENV_OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

`scripts/e2e.mjs`:

```js
import { spawnSync } from 'node:child_process';

const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: true }).status ?? 1;

const up = run('pnpm', ['docker:up']);
let code = up;
if (up === 0) {
  code = run('pnpm', ['--filter', '@marketplace/engine', 'test:e2e']);
}
run('pnpm', ['docker:down']);
process.exit(code);
```

- [ ] **Step 3: Bring the stack up and run the verification test**

Run: `pnpm install && pnpm docker:up`
Expected: all services healthy, `seed` container exits 0, `docker/.env.generated` exists.

Run: `pnpm --filter @marketplace/seed test`
Expected: PASS, all three assertions.

If the JWKS assertion fails, inspect `docker compose -f docker/docker-compose.yml logs cognito-local` — a pool must exist before `cognito-local` serves its JWKS route. Re-running `pnpm docker:up` re-runs the idempotent seed.

**Verify the issuer assumption before moving on.** `JWT_ISSUER` above assumes `cognito-local` stamps `iss` with the origin the token was requested through. Confirm it once Task 5's `tokenFor` helper exists, by decoding a minted token:

```bash
node -e "const t=process.argv[1];console.log(JSON.parse(Buffer.from(t.split('.')[1],'base64url')))" "$TOKEN"
```

The printed `iss` must equal the `JWT_ISSUER` line in `docker/.env.generated`. If it differs, change the `hostOrigin` value in `seed.ts` to match what the token actually carries and re-run `pnpm docker:up`. Nothing else in the design depends on which host wins — only that the two agree.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add docker compose stack with dynamodb, sqs, redis and cognito seeding"
```

---

### Task 4: Engine skeleton, config and health

**Files:**
- Create: `apps/engine/package.json`, `tsconfig.json`, `jest.config.js`, `jest-e2e.config.js`, `Dockerfile`, `nest-cli.json`
- Create: `apps/engine/src/main.ts`, `src/app.module.ts`, `src/config/env.schema.ts`, `src/config/config.module.ts`, `src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `apps/engine/test/e2e/setup.ts`, `apps/engine/test/e2e/health.e2e.test.ts`
- Modify: `docker/docker-compose.yml` (add the `engine` service)

**Interfaces:**
- Consumes: `docker/.env.generated` from Task 3.
- Produces: `EnvConfig` type and `ConfigModule` exporting an injectable `ENV` token; a booted app on port 3000; the e2e harness that every later e2e test imports (`apps/engine/test/e2e/setup.ts` exporting `baseUrl`).

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/setup.ts`:

```ts
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../docker/.env.generated') });

export const baseUrl = process.env.ENGINE_BASE_URL ?? 'http://localhost:3000';

export async function waitForHealthy(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${baseUrl}/api/v1/health/ready`);
      if (res.status === 200) return;
    } catch {
      // engine not listening yet
    }
    if (Date.now() > deadline) throw new Error('engine did not become healthy');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
```

`apps/engine/test/e2e/health.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';

describe('health', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('reports liveness', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(res.status).toBe(200);
  });

  it('reports readiness once dynamodb and redis are reachable', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dynamodb: 'ok', redis: 'ok' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — the engine service does not exist yet, so `waitForHealthy` times out.

- [ ] **Step 3: Create the application**

`apps/engine/package.json`:

```json
{
  "name": "@marketplace/engine",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "node dist/main.js",
    "start:dev": "nest start --watch",
    "test": "jest",
    "test:e2e": "jest --config jest-e2e.config.js --runInBand"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.665.0",
    "@aws-sdk/client-sqs": "^3.665.0",
    "@aws-sdk/lib-dynamodb": "^3.665.0",
    "@marketplace/contracts": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "ioredis": "^5.4.1",
    "jose": "^5.9.3",
    "nestjs-pino": "^4.1.0",
    "pino-http": "^10.3.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@aws-sdk/client-cognito-identity-provider": "^3.665.0",
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "@types/supertest": "^6.0.2",
    "dotenv": "^16.4.5",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  }
}
```

`apps/engine/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "baseUrl": "." },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "test/**/*"]
}
```

`apps/engine/nest-cli.json`:

```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

`apps/engine/jest.config.js` (unit + integration):

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.(test|int-test)\\.ts$',
};
```

`apps/engine/jest-e2e.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test/e2e',
  testRegex: '.*\\.e2e\\.test\\.ts$',
  testTimeout: 60000,
};
```

`apps/engine/src/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3000),
  AWS_REGION: z.string().default('us-east-1'),
  TABLE_NAME: z.string().default('MarketplaceEngine'),
  DYNAMODB_ENDPOINT: z.string().url().optional(),
  SQS_ENDPOINT: z.string().url().optional(),
  QUEUE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWKS_URI: z.string().url(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SQS_CONSUMER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');
```

`DYNAMODB_ENDPOINT` and `SQS_ENDPOINT` being optional is the whole environment-portability mechanism: unset means the SDK resolves real AWS endpoints. No code branches.

`apps/engine/src/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ENV, EnvSchema } from './env.schema';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => EnvSchema.parse(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
```

`apps/engine/src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject } from '@nestjs/common';
import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';

@Controller('health')
export class HealthController {
  private readonly ddb: DynamoDBClient;
  private readonly redis: Redis;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.ddb = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
    this.redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  }

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ dynamodb: string; redis: string }> {
    await this.ddb.send(new DescribeTableCommand({ TableName: this.env.TABLE_NAME }));
    await this.redis.connect().catch(() => undefined);
    await this.redis.ping();
    return { dynamodb: 'ok', redis: 'ok' };
  }
}
```

`apps/engine/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/engine/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req, res) => {
          const id = (req.headers['x-request-id'] as string) ?? crypto.randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
      },
    }),
    ConfigModule,
    HealthModule,
  ],
})
export class AppModule {}
```

`apps/engine/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  const env = app.get<EnvConfig>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
```

`apps/engine/Dockerfile`:

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @marketplace/contracts build && pnpm --filter @marketplace/engine build
WORKDIR /repo/apps/engine
CMD ["node", "dist/main.js"]
```

Add to `docker/docker-compose.yml` under `services:`:

```yaml
  engine:
    build: { context: .., dockerfile: apps/engine/Dockerfile }
    ports: ['3000:3000']
    env_file: ['./.env.generated']
    environment:
      PORT: '3000'
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
      TABLE_NAME: MarketplaceEngine
      DYNAMODB_ENDPOINT: http://dynamodb-local:8000
      SQS_ENDPOINT: http://localstack:4566
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: info
    depends_on:
      seed: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3000/api/v1/health/live || exit 1']
      interval: 3s
      retries: 30
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, both health tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add engine application skeleton with config validation and health probes"
```

---

### Task 5: Tenant context, JWT verification and the auth guard

**Files:**
- Create: `apps/engine/src/common/tenant-context.ts`
- Create: `apps/engine/src/auth/claims.ts`, `src/auth/jwt-verifier.ts`, `src/auth/jwt-auth.guard.ts`, `src/auth/public.decorator.ts`, `src/auth/auth.module.ts`, `src/auth/me.controller.ts`
- Modify: `apps/engine/src/app.module.ts`, `src/health/health.controller.ts`
- Test: `apps/engine/src/auth/claims.test.ts`, `apps/engine/test/e2e/helpers/auth.ts`, `apps/engine/test/e2e/auth.e2e.test.ts`

**Interfaces:**
- Consumes: `ENV`, `EnvConfig` (Task 4).
- Produces:
  - `TenantPrincipal { tenantId: string; userId: string; role: string | null }`
  - `runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T`
  - `currentPrincipal(): TenantPrincipal` — throws if called outside a tenant scope
  - `currentTenantId(): string`
  - `principalFromClaims(claims: Record<string, unknown>): TenantPrincipal` — throws `UnauthorizedException` on a missing claim
  - `@Public()` route decorator
  - e2e helper `tokenFor(tenantId: string, username: string): Promise<string>`

**Fidelity note:** the helper requests the **ID token**, not the access token. Cognito access tokens do not carry `custom:` attributes without a pre-token-generation trigger; ID tokens do. `JWT_AUDIENCE` is therefore the app client id, which is what Cognito puts in an ID token's `aud`.

- [ ] **Step 1: Write the failing unit test**

`apps/engine/src/auth/claims.test.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { principalFromClaims } from './claims';

describe('principalFromClaims', () => {
  it('maps cognito claims to a principal', () => {
    expect(
      principalFromClaims({ sub: 'user-1', 'custom:tenant_id': 'client_123', 'custom:role': 'admin' }),
    ).toEqual({ tenantId: 'client_123', userId: 'user-1', role: 'admin' });
  });

  it('defaults a missing role to null', () => {
    expect(principalFromClaims({ sub: 'user-1', 'custom:tenant_id': 'client_123' }).role).toBeNull();
  });

  it('rejects a token with no tenant claim', () => {
    expect(() => principalFromClaims({ sub: 'user-1' })).toThrow(UnauthorizedException);
  });

  it('rejects a token with no subject', () => {
    expect(() => principalFromClaims({ 'custom:tenant_id': 'client_123' })).toThrow(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 2: Write the failing e2e test**

`apps/engine/test/e2e/helpers/auth.ts`:

```ts
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import '../setup';

const PASSWORD = 'Passw0rd!';

const client = new CognitoIdentityProviderClient({
  region: 'us-east-1',
  endpoint: process.env.COGNITO_ENDPOINT_HOST,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

export async function tokenFor(tenantId: string, username: string): Promise<string> {
  const poolId = process.env.COGNITO_USER_POOL_ID!;
  const clientId = process.env.COGNITO_CLIENT_ID!;

  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: poolId,
        Username: username,
        MessageAction: 'SUPPRESS',
        UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
      }),
    );
  } catch (err) {
    if ((err as Error).name !== 'UsernameExistsException') throw err;
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: poolId,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  );

  const res = await client.send(
    new InitiateAuthCommand({
      ClientId: clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD },
    }),
  );

  return res.AuthenticationResult!.IdToken!;
}

export async function authHeaders(tenantId: string, username: string): Promise<HeadersInit> {
  return { authorization: `Bearer ${await tokenFor(tenantId, username)}`, 'content-type': 'application/json' };
}
```

`apps/engine/test/e2e/auth.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders, tokenFor } from './helpers/auth';

describe('authentication', () => {
  beforeAll(async () => {
    await waitForHealthy();
  });

  it('rejects a request with no token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`);
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('rejects a malformed token', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('resolves the tenant from the token claim', async () => {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: await authHeaders('tenant_a', 'alice@example.com'),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tenantId: 'tenant_a' });
  });

  it('issues distinct tenants distinct principals', async () => {
    const a = await tokenFor('tenant_a', 'alice@example.com');
    const b = await tokenFor('tenant_b', 'bob@example.com');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './claims'`.

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `/api/v1/me` returns 404.

- [ ] **Step 4: Implement**

`apps/engine/src/common/tenant-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantPrincipal {
  tenantId: string;
  userId: string;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantPrincipal>();

/** Wraps a callback in a tenant scope. Used by tests and the SQS consumer. */
export function runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

/**
 * Binds the tenant to the current async execution and everything it spawns.
 * The guard needs this rather than runWithTenant, because a guard returns
 * before the controller runs — a callback scope would already have exited.
 */
export function enterTenant(principal: TenantPrincipal): void {
  storage.enterWith(principal);
}

export function currentPrincipal(): TenantPrincipal {
  const principal = storage.getStore();
  if (!principal) {
    throw new Error('no tenant context: this code must run inside runWithTenant');
  }
  return principal;
}

export function currentTenantId(): string {
  return currentPrincipal().tenantId;
}
```

`apps/engine/src/auth/claims.ts`:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { TenantPrincipal } from '../common/tenant-context';

export function principalFromClaims(claims: Record<string, unknown>): TenantPrincipal {
  const tenantId = claims['custom:tenant_id'];
  const userId = claims['sub'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new UnauthorizedException('token is missing the custom:tenant_id claim');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new UnauthorizedException('token is missing the sub claim');
  }
  const role = claims['custom:role'];
  return { tenantId, userId, role: typeof role === 'string' ? role : null };
}
```

`apps/engine/src/auth/jwt-verifier.ts`:

```ts
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ENV, EnvConfig } from '../config/env.schema';
import { TenantPrincipal } from '../common/tenant-context';
import { principalFromClaims } from './claims';

@Injectable()
export class JwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    // Lazy: no network call until the first token is verified.
    this.jwks = createRemoteJWKSet(new URL(env.JWKS_URI));
  }

  async verify(token: string): Promise<TenantPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
      });
      return principalFromClaims(payload as Record<string, unknown>);
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException('token verification failed');
    }
  }
}
```

`apps/engine/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`apps/engine/src/auth/jwt-auth.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { enterTenant } from '../common/tenant-context';
import { IS_PUBLIC } from './public.decorator';
import { JwtVerifier } from './jwt-verifier';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }

    const principal = await this.verifier.verify(header.slice('Bearer '.length));

    // enterTenant, not runWithTenant: the scope must outlive this method and
    // cover the interceptor, pipe, controller and every call beneath them.
    enterTenant(principal);
    return true;
  }
}
```

`apps/engine/src/auth/me.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { currentPrincipal, TenantPrincipal } from '../common/tenant-context';

@Controller('me')
export class MeController {
  @Get()
  me(): TenantPrincipal {
    return currentPrincipal();
  }
}
```

`apps/engine/src/auth/auth.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifier } from './jwt-verifier';
import { MeController } from './me.controller';

@Global()
@Module({
  controllers: [MeController],
  providers: [JwtVerifier, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  exports: [JwtVerifier],
})
export class AuthModule {}
```

Mark both health routes public — add `@Public()` above `live()` and `ready()` in `health.controller.ts` and import it from `../auth/public.decorator`.

Register `AuthModule` in `app.module.ts` imports, after `ConfigModule`.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, four `principalFromClaims` cases.

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, health and auth suites. The `application/problem+json` assertion fails until Task 8 — if so, temporarily assert only on `res.status` and restore the content-type assertion in Task 8. Note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: verify cognito JWTs and bind tenant identity to the request scope"
```

---

### Task 6: Key, cursor and identifier utilities

**Files:**
- Create: `apps/engine/src/persistence/keys.ts`, `apps/engine/src/common/cursor.ts`, `apps/engine/src/common/ids.ts`
- Test: `apps/engine/src/persistence/keys.test.ts`, `apps/engine/src/common/cursor.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SK_PREFIX: Record<KeyedEntityType, string>` where `KeyedEntityType = 'Product' | 'Order' | 'Event' | 'Booking' | 'Flow'`
  - `tenantPk(tenantId: string): string`
  - `entitySk(type: KeyedEntityType, id: string): string`
  - `skPrefix(type: KeyedEntityType): string`
  - `schemaSk(entityType: string): string`
  - `gsi1UserPk(tenantId: string, userId: string): string`
  - `gsi1UserSk(type: 'Order' | 'Booking', createdAt: string, id: string): string`
  - `normalizeTenantId(raw: string): string` — strips a `TENANT#` prefix
  - `encodeCursor(key: Record<string, unknown>): string`
  - `decodeCursor(cursor: string): Record<string, unknown>` — throws `BadRequestException`
  - `newId(): string` — ULID

- [ ] **Step 1: Write the failing tests**

`apps/engine/src/persistence/keys.test.ts`:

```ts
import { entitySk, gsi1UserPk, gsi1UserSk, normalizeTenantId, schemaSk, skPrefix, tenantPk } from './keys';

describe('key builders', () => {
  it('builds a tenant partition key', () => {
    expect(tenantPk('client_123')).toBe('TENANT#client_123');
  });

  it('builds entity sort keys', () => {
    expect(entitySk('Product', '01J000000000000000000000AB')).toBe('PRODUCT#01J000000000000000000000AB');
    expect(skPrefix('Order')).toBe('ORDER#');
    expect(schemaSk('Product')).toBe('SCHEMA#Product');
  });

  it('builds the user index keys', () => {
    expect(gsi1UserPk('client_123', 'user-1')).toBe('TENANT#client_123#USER#user-1');
    expect(gsi1UserSk('Order', '2026-08-03T10:00:00.000Z', 'abc')).toBe(
      'ORDER#2026-08-03T10:00:00.000Z#abc',
    );
  });

  it('normalizes a tenant id that already carries the prefix', () => {
    expect(normalizeTenantId('TENANT#client_123')).toBe('client_123');
    expect(normalizeTenantId('client_123')).toBe('client_123');
  });
});
```

`apps/engine/src/common/cursor.test.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { decodeCursor, encodeCursor } from './cursor';

describe('cursor', () => {
  it('round-trips a last evaluated key', () => {
    const key = { PK: 'TENANT#a', SK: 'PRODUCT#01J' };
    expect(decodeCursor(encodeCursor(key))).toEqual(key);
  });

  it('produces a url-safe string', () => {
    expect(encodeCursor({ PK: 'TENANT#a?b/c+d' })).not.toMatch(/[+/=]/);
  });

  it('rejects a cursor that is not base64', () => {
    expect(() => decodeCursor('!!!not-base64!!!')).toThrow(BadRequestException);
  });

  it('rejects a cursor that decodes to a non-object', () => {
    expect(() => decodeCursor(Buffer.from('"a string"').toString('base64url'))).toThrow(
      BadRequestException,
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './keys'`.

- [ ] **Step 3: Implement**

`apps/engine/src/persistence/keys.ts`:

```ts
export type KeyedEntityType = 'Product' | 'Order' | 'Event' | 'Booking' | 'Flow';

export const SK_PREFIX: Record<KeyedEntityType, string> = {
  Product: 'PRODUCT#',
  Order: 'ORDER#',
  Event: 'EVENT#',
  Booking: 'BOOKING#',
  Flow: 'FLOW#',
};

export function tenantPk(tenantId: string): string {
  return `TENANT#${tenantId}`;
}

export function skPrefix(type: KeyedEntityType): string {
  return SK_PREFIX[type];
}

export function entitySk(type: KeyedEntityType, id: string): string {
  return `${SK_PREFIX[type]}${id}`;
}

export function schemaSk(entityType: string): string {
  return `SCHEMA#${entityType}`;
}

export function gsi1UserPk(tenantId: string, userId: string): string {
  return `TENANT#${tenantId}#USER#${userId}`;
}

export function gsi1UserSk(type: 'Order' | 'Booking', createdAt: string, id: string): string {
  return `${SK_PREFIX[type]}${createdAt}#${id}`;
}

export function normalizeTenantId(raw: string): string {
  return raw.startsWith('TENANT#') ? raw.slice('TENANT#'.length) : raw;
}
```

`apps/engine/src/common/cursor.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException('cursor is not a valid pagination token');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('cursor is not a valid pagination token');
  }
  return parsed as Record<string, unknown>;
}
```

`apps/engine/src/common/ids.ts`:

```ts
import { ulid } from 'ulid';

export function newId(): string {
  return ulid();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, all key and cursor cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add single-table key builders, opaque cursors and ULID generation"
```

---

### Task 7: DynamoRepository

**Files:**
- Create: `apps/engine/src/persistence/dynamo.client.ts`, `src/persistence/dynamo.repository.ts`, `src/persistence/persistence.module.ts`
- Test: `apps/engine/src/persistence/dynamo.repository.int-test.ts`

**Interfaces:**
- Consumes: `ENV` (Task 4), `currentTenantId`, `runWithTenant` (Task 5), key builders and cursors (Task 6).
- Produces `DynamoRepository` with:
  - `put(sk: string, item: Record<string, unknown>): Promise<void>`
  - `putIfAbsent(sk: string, item: Record<string, unknown>): Promise<boolean>`
  - `get<T>(sk: string): Promise<T | null>`
  - `queryPrefix<T>(prefix: string, opts?: QueryOptions): Promise<Page<T>>`
  - `queryUserIndex<T>(userId: string, prefix: string, opts?: QueryOptions): Promise<Page<T>>`
  - `transactWrite(items: TransactWriteCommandInput['TransactItems']): Promise<void>`
  - `readonly tableName: string`
  - `key(sk: string): { PK: string; SK: string }` — for building transaction items in feature services
  - `QueryOptions { limit?: number; cursor?: string | null; filter?: FilterSpec }`
  - `FilterSpec { expression: string; names: Record<string, string>; values: Record<string, unknown> }`

No method takes a tenant argument. `PK` is read from the ambient tenant context, which is what makes a cross-tenant query unexpressible.

- [ ] **Step 1: Write the failing integration test**

`apps/engine/src/persistence/dynamo.repository.int-test.ts`:

```ts
import { DynamoRepository } from './dynamo.repository';
import { runWithTenant } from '../common/tenant-context';
import { entitySk, skPrefix } from './keys';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: process.env.TABLE_NAME ?? 'MarketplaceEngine',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
} as EnvConfig;

const repo = new DynamoRepository(env);
const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);

const uniq = () => Math.random().toString(36).slice(2, 10);

describe('DynamoRepository', () => {
  it('round-trips an item within a tenant', async () => {
    const t = `t_${uniq()}`;
    const sk = entitySk('Product', 'ID1');
    await asTenant(t, () => repo.put(sk, { entityType: 'Product', id: 'ID1', name: 'Chair' }));
    const found = await asTenant(t, () => repo.get<{ name: string }>(sk));
    expect(found?.name).toBe('Chair');
  });

  it('does not leak items across tenants', async () => {
    const sk = entitySk('Product', 'ID2');
    await asTenant('tenant_a', () => repo.put(sk, { entityType: 'Product', id: 'ID2' }));
    const found = await asTenant('tenant_b', () => repo.get(sk));
    expect(found).toBeNull();
  });

  it('refuses to write with no tenant context', async () => {
    await expect(repo.put(entitySk('Product', 'ID3'), {})).rejects.toThrow(/no tenant context/);
  });

  it('paginates a prefix query and returns a resumable cursor', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      for (let i = 0; i < 5; i++) {
        await repo.put(entitySk('Product', `ID${i}`), { entityType: 'Product', id: `ID${i}` });
      }
    });

    const first = await asTenant(t, () => repo.queryPrefix(skPrefix('Product'), { limit: 2 }));
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await asTenant(t, () =>
      repo.queryPrefix(skPrefix('Product'), { limit: 2, cursor: first.nextCursor }),
    );
    expect(second.items).toHaveLength(2);
    expect(second.items).not.toEqual(first.items);
  });

  it('applies a filter expression', async () => {
    const t = `t_${uniq()}`;
    await asTenant(t, async () => {
      await repo.put(entitySk('Product', 'IDA'), { entityType: 'Product', category: 'chairs' });
      await repo.put(entitySk('Product', 'IDB'), { entityType: 'Product', category: 'desks' });
    });

    const page = await asTenant(t, () =>
      repo.queryPrefix<{ category: string }>(skPrefix('Product'), {
        filter: { expression: '#c = :c', names: { '#c': 'category' }, values: { ':c': 'chairs' } },
      }),
    );
    expect(page.items.map((i) => i.category)).toEqual(['chairs']);
  });

  it('putIfAbsent returns false on a second write', async () => {
    const t = `t_${uniq()}`;
    const sk = entitySk('Flow', 'F1');
    expect(await asTenant(t, () => repo.putIfAbsent(sk, { entityType: 'Flow' }))).toBe(true);
    expect(await asTenant(t, () => repo.putIfAbsent(sk, { entityType: 'Flow' }))).toBe(false);
  });

  it('queries the user index', async () => {
    const t = `t_${uniq()}`;
    await runWithTenant({ tenantId: t, userId: 'user-9', role: null }, async () => {
      await repo.put(entitySk('Order', 'O1'), {
        entityType: 'Order',
        GSI1PK: `TENANT#${t}#USER#user-9`,
        GSI1SK: 'ORDER#2026-08-03T10:00:00.000Z#O1',
      });
      const page = await repo.queryUserIndex('user-9', skPrefix('Order'));
      expect(page.items).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './dynamo.repository'`.

- [ ] **Step 3: Implement**

`apps/engine/src/persistence/dynamo.client.ts`:

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { EnvConfig } from '../config/env.schema';

export function createDocumentClient(env: EnvConfig): DynamoDBDocumentClient {
  const base = new DynamoDBClient({ region: env.AWS_REGION, endpoint: env.DYNAMODB_ENDPOINT });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true, convertClassInstanceToMap: false },
  });
}
```

`apps/engine/src/persistence/dynamo.repository.ts`:

```ts
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { Inject, Injectable } from '@nestjs/common';
import { Page } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { currentTenantId } from '../common/tenant-context';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { createDocumentClient } from './dynamo.client';
import { gsi1UserPk, tenantPk } from './keys';

export interface FilterSpec {
  expression: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
}

export interface QueryOptions {
  limit?: number;
  cursor?: string | null;
  filter?: FilterSpec;
}

@Injectable()
export class DynamoRepository {
  private readonly doc: DynamoDBDocumentClient;
  readonly tableName: string;

  constructor(@Inject(ENV) env: EnvConfig) {
    this.doc = createDocumentClient(env);
    this.tableName = env.TABLE_NAME;
  }

  key(sk: string): { PK: string; SK: string } {
    return { PK: tenantPk(currentTenantId()), SK: sk };
  }

  async put(sk: string, item: Record<string, unknown>): Promise<void> {
    await this.doc.send(
      new PutCommand({ TableName: this.tableName, Item: { ...item, ...this.key(sk) } }),
    );
  }

  async putIfAbsent(sk: string, item: Record<string, unknown>): Promise<boolean> {
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { ...item, ...this.key(sk) },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) return false;
      throw err;
    }
  }

  async get<T>(sk: string): Promise<T | null> {
    const out = await this.doc.send(
      new GetCommand({ TableName: this.tableName, Key: this.key(sk) }),
    );
    return (out.Item as T | undefined) ?? null;
  }

  async queryPrefix<T>(prefix: string, opts: QueryOptions = {}): Promise<Page<T>> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: opts.filter?.expression,
        ExpressionAttributeNames: opts.filter?.names,
        ExpressionAttributeValues: {
          ':pk': tenantPk(currentTenantId()),
          ':sk': prefix,
          ...(opts.filter?.values ?? {}),
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async queryUserIndex<T>(userId: string, prefix: string, opts: QueryOptions = {}): Promise<Page<T>> {
    const out = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': gsi1UserPk(currentTenantId(), userId),
          ':sk': prefix,
        },
        Limit: opts.limit,
        ExclusiveStartKey: opts.cursor ? decodeCursor(opts.cursor) : undefined,
        ScanIndexForward: false,
      }),
    );
    return {
      items: (out.Items ?? []) as T[],
      nextCursor: out.LastEvaluatedKey ? encodeCursor(out.LastEvaluatedKey) : null,
    };
  }

  async transactWrite(items: TransactWriteCommandInput['TransactItems']): Promise<void> {
    await this.doc.send(new TransactWriteCommand({ TransactItems: items }));
  }
}
```

`apps/engine/src/persistence/persistence.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { DynamoRepository } from './dynamo.repository';

@Global()
@Module({ providers: [DynamoRepository], exports: [DynamoRepository] })
export class PersistenceModule {}
```

Register `PersistenceModule` in `app.module.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, all seven repository cases. The cross-tenant and no-context cases are the two that matter — they are the mechanical proof of the isolation guarantee.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add tenant-scoped DynamoDB repository with pagination and transactions"
```

---

### Task 8: Problem details and the exception filter

**Files:**
- Create: `apps/engine/src/common/problem.ts`, `apps/engine/src/common/problem.filter.ts`, `apps/engine/src/common/transaction-errors.ts`
- Modify: `apps/engine/src/main.ts`
- Test: `apps/engine/src/common/problem.test.ts`, `apps/engine/src/common/transaction-errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ProblemType` union: `'insufficient-stock' | 'price-changed' | 'event-at-capacity' | 'schema-validation-failed' | 'unsupported-schema-change' | 'too-many-line-items' | 'mixed-currency-order' | 'request-in-progress' | 'unauthorized' | 'not-found' | 'invalid-request' | 'internal-error'`
  - `class ProblemException extends HttpException` with `constructor(type: ProblemType, status: number, title: string, detail?: string, extra?: Record<string, unknown>)`
  - `ProblemFilter` — a global `ExceptionFilter`
  - `failedTransactionIndexes(err: unknown): number[]` — indexes whose `CancellationReasons[i].Code === 'ConditionalCheckFailed'`

- [ ] **Step 1: Write the failing tests**

`apps/engine/src/common/problem.test.ts`:

```ts
import { ProblemException } from './problem';

describe('ProblemException', () => {
  it('carries type, status, title and extras', () => {
    const err = new ProblemException('insufficient-stock', 409, 'Insufficient stock', 'only 2 left', {
      productId: 'P1',
    });
    expect(err.getStatus()).toBe(409);
    expect(err.problem).toMatchObject({
      type: 'https://marketplace.local/problems/insufficient-stock',
      title: 'Insufficient stock',
      status: 409,
      detail: 'only 2 left',
      productId: 'P1',
    });
  });
});
```

`apps/engine/src/common/transaction-errors.test.ts`:

```ts
import { failedTransactionIndexes } from './transaction-errors';

describe('failedTransactionIndexes', () => {
  it('reports which transaction items failed their condition', () => {
    const err = {
      name: 'TransactionCanceledException',
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ],
    };
    expect(failedTransactionIndexes(err)).toEqual([1, 3]);
  });

  it('returns an empty list for an unrelated error', () => {
    expect(failedTransactionIndexes(new Error('boom'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './problem'`.

- [ ] **Step 3: Implement**

`apps/engine/src/common/problem.ts`:

```ts
import { HttpException } from '@nestjs/common';

export type ProblemType =
  | 'insufficient-stock'
  | 'price-changed'
  | 'event-at-capacity'
  | 'schema-validation-failed'
  | 'unsupported-schema-change'
  | 'too-many-line-items'
  | 'mixed-currency-order'
  | 'request-in-progress'
  | 'unauthorized'
  | 'not-found'
  | 'invalid-request'
  | 'internal-error';

export interface ProblemBody extends Record<string, unknown> {
  type: string;
  title: string;
  status: number;
  detail?: string;
}

export class ProblemException extends HttpException {
  readonly problem: ProblemBody;

  constructor(
    type: ProblemType,
    status: number,
    title: string,
    detail?: string,
    extra: Record<string, unknown> = {},
  ) {
    const problem: ProblemBody = {
      type: `https://marketplace.local/problems/${type}`,
      title,
      status,
      ...(detail === undefined ? {} : { detail }),
      ...extra,
    };
    super(problem, status);
    this.problem = problem;
  }
}
```

`apps/engine/src/common/transaction-errors.ts`:

```ts
interface CancellationReason {
  Code?: string;
}

export function failedTransactionIndexes(err: unknown): number[] {
  const reasons = (err as { CancellationReasons?: CancellationReason[] })?.CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.flatMap((r, i) => (r?.Code === 'ConditionalCheckFailed' ? [i] : []));
}
```

`apps/engine/src/common/problem.filter.ts`:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemBody, ProblemException } from './problem';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';

    const body = this.toProblem(exception);
    if (body.status >= 500) {
      this.logger.error({ err: exception, traceId }, 'unhandled error');
    }

    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, instance: req.originalUrl, traceId });
  }

  private toProblem(exception: unknown): ProblemBody {
    if (exception instanceof ProblemException) return exception.problem;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const slug =
        status === HttpStatus.UNAUTHORIZED
          ? 'unauthorized'
          : status === HttpStatus.NOT_FOUND
            ? 'not-found'
            : status < 500
              ? 'invalid-request'
              : 'internal-error';
      const response = exception.getResponse();
      const detail =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      return {
        type: `https://marketplace.local/problems/${slug}`,
        title: exception.name,
        status,
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
      };
    }

    return {
      type: 'https://marketplace.local/problems/internal-error',
      title: 'Internal Server Error',
      status: 500,
    };
  }
}
```

Register it globally in `main.ts`, after `setGlobalPrefix`:

```ts
app.useGlobalFilters(new ProblemFilter());
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS.

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS — and the `application/problem+json` assertion deferred in Task 5 now holds. Restore it if it was relaxed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: return RFC 9457 problem details and decode transaction cancellation reasons"
```

---

### Task 9: Schema registry

**Files:**
- Create: `apps/engine/src/redis/redis.module.ts`
- Create: `apps/engine/src/registry/attribute-validator.ts`, `src/registry/schema-registry.service.ts`, `src/registry/registry.module.ts`
- Test: `apps/engine/src/registry/attribute-validator.test.ts`, `src/registry/schema-registry.service.int-test.ts`

**Interfaces:**
- Consumes: `DynamoRepository` (Task 7), `ProblemException` (Task 8), `schemaSk` (Task 6), contracts types (Task 2).
- Produces:
  - `REDIS` injection token and `RedisModule` (global), providing an `ioredis` instance
  - `FieldError { field: string; code: 'unknown_field' | 'required' | 'invalid_type'; message: string }`
  - `validateAttributes(fields: Record<string, FieldDefinition>, input: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; errors: FieldError[] }`
  - `SchemaRegistryService` with `get(entityType)`, `validate(entityType, attributes)`, `applyAddFields(entityType, addedFields)`, `invalidate(entityType)`

- [ ] **Step 1: Write the failing unit test**

`apps/engine/src/registry/attribute-validator.test.ts`:

```ts
import { FieldDefinition } from '@marketplace/contracts';
import { validateAttributes } from './attribute-validator';

const fields: Record<string, FieldDefinition> = {
  dietaryNeeds: { type: 'string', required: false, default: 'none' },
  seats: { type: 'number', required: true, default: null },
  vip: { type: 'boolean', required: false, default: null },
  tags: { type: 'string[]', required: false, default: null },
  startsOn: { type: 'date', required: false, default: null },
};

describe('validateAttributes', () => {
  it('accepts valid input and applies defaults for absent optional fields', () => {
    const result = validateAttributes(fields, { seats: 4 });
    expect(result).toEqual({ ok: true, value: { seats: 4, dietaryNeeds: 'none' } });
  });

  it('reports a missing required field', () => {
    const result = validateAttributes(fields, {});
    expect(result).toMatchObject({ ok: false });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'seats', code: 'required' }),
    );
  });

  it('reports an unknown field', () => {
    const result = validateAttributes(fields, { seats: 4, colour: 'red' });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'colour', code: 'unknown_field' }),
    );
  });

  it('reports a wrong scalar type', () => {
    const result = validateAttributes(fields, { seats: 'four' });
    expect((result as { errors: unknown[] }).errors).toContainEqual(
      expect.objectContaining({ field: 'seats', code: 'invalid_type' }),
    );
  });

  it('validates array element types', () => {
    expect(validateAttributes(fields, { seats: 1, tags: ['a', 'b'] }).ok).toBe(true);
    expect(validateAttributes(fields, { seats: 1, tags: ['a', 2] }).ok).toBe(false);
  });

  it('validates ISO-8601 dates', () => {
    expect(validateAttributes(fields, { seats: 1, startsOn: '2026-08-03T10:00:00.000Z' }).ok).toBe(true);
    expect(validateAttributes(fields, { seats: 1, startsOn: 'tomorrow' }).ok).toBe(false);
  });

  it('accepts anything when the tenant has defined no fields', () => {
    expect(validateAttributes({}, {})).toEqual({ ok: true, value: {} });
  });
});
```

- [ ] **Step 2: Write the failing integration test**

`apps/engine/src/registry/schema-registry.service.int-test.ts`:

```ts
import Redis from 'ioredis';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from './schema-registry.service';
import { runWithTenant } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  TABLE_NAME: process.env.TABLE_NAME ?? 'MarketplaceEngine',
  DYNAMODB_ENDPOINT: process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000',
} as EnvConfig;

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const repo = new DynamoRepository(env);
const registry = new SchemaRegistryService(repo, redis);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);
const uniq = () => `t_${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await redis.quit();
});

describe('SchemaRegistryService', () => {
  it('returns an empty schema at version 0 for a new tenant', async () => {
    const schema = await asTenant(uniq(), () => registry.get('Product'));
    expect(schema).toEqual({ version: 0, fields: {} });
  });

  it('adds fields and bumps the version', async () => {
    const t = uniq();
    const v1 = await asTenant(t, () =>
      registry.applyAddFields('Product', [
        { name: 'dietaryNeeds', type: 'string', required: false, default: null },
      ]),
    );
    expect(v1).toBe(1);

    const schema = await asTenant(t, () => registry.get('Product'));
    expect(schema.version).toBe(1);
    expect(schema.fields.dietaryNeeds.type).toBe('string');
  });

  it('rejects adding a field that already exists', async () => {
    const t = uniq();
    const field = { name: 'dietaryNeeds', type: 'string' as const, required: false, default: null };
    await asTenant(t, () => registry.applyAddFields('Product', [field]));
    await expect(asTenant(t, () => registry.applyAddFields('Product', [field]))).rejects.toBeInstanceOf(
      ProblemException,
    );
  });

  it('enforces the schema on validate and invalidates its cache on write', async () => {
    const t = uniq();
    await asTenant(t, () => registry.validate('Product', {}));

    await asTenant(t, () =>
      registry.applyAddFields('Product', [
        { name: 'seats', type: 'number', required: true, default: null },
      ]),
    );

    await expect(asTenant(t, () => registry.validate('Product', {}))).rejects.toBeInstanceOf(
      ProblemException,
    );
    expect(await asTenant(t, () => registry.validate('Product', { seats: 2 }))).toEqual({ seats: 2 });
  });

  it('keeps registries separate across tenants', async () => {
    const a = uniq();
    const b = uniq();
    await asTenant(a, () =>
      registry.applyAddFields('Product', [
        { name: 'onlyForA', type: 'string', required: false, default: null },
      ]),
    );
    expect((await asTenant(b, () => registry.get('Product'))).fields).toEqual({});
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './attribute-validator'`.

- [ ] **Step 4: Implement**

`apps/engine/src/redis/redis.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: EnvConfig) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule {}
```

`apps/engine/src/registry/attribute-validator.ts`:

```ts
import { FieldDefinition, FieldType } from '@marketplace/contracts';

export interface FieldError {
  field: string;
  code: 'unknown_field' | 'required' | 'invalid_type';
  message: string;
}

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: FieldError[] };

function matchesScalar(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value);
    default:
      return false;
  }
}

function matchesType(type: FieldType, value: unknown): boolean {
  if (type.endsWith('[]')) {
    const element = type.slice(0, -2);
    return Array.isArray(value) && value.every((v) => matchesScalar(element, v));
  }
  return matchesScalar(type, value);
}

export function validateAttributes(
  fields: Record<string, FieldDefinition>,
  input: Record<string, unknown>,
): ValidationResult {
  const errors: FieldError[] = [];
  const value: Record<string, unknown> = {};

  for (const key of Object.keys(input)) {
    if (!(key in fields)) {
      errors.push({ field: key, code: 'unknown_field', message: `${key} is not defined for this tenant` });
    }
  }

  for (const [name, definition] of Object.entries(fields)) {
    const provided = input[name];
    const absent = provided === undefined || provided === null;

    if (absent) {
      if (definition.required) {
        errors.push({ field: name, code: 'required', message: `${name} is required` });
      } else if (definition.default !== null && definition.default !== undefined) {
        value[name] = definition.default;
      }
      continue;
    }

    if (!matchesType(definition.type, provided)) {
      errors.push({ field: name, code: 'invalid_type', message: `${name} must be of type ${definition.type}` });
      continue;
    }

    value[name] = provided;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
```

`apps/engine/src/registry/schema-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import {
  AddedField,
  DynamicEntityType,
  EntitySchemaRecord,
  EntitySchemaRecordSchema,
  FieldDefinition,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { REDIS } from '../redis/redis.module';
import { schemaSk } from '../persistence/keys';
import { currentTenantId } from '../common/tenant-context';
import { ProblemException } from '../common/problem';
import { validateAttributes } from './attribute-validator';

const EMPTY: EntitySchemaRecord = { version: 0, fields: {} };
const CACHE_TTL_SECONDS = 300;

@Injectable()
export class SchemaRegistryService {
  constructor(
    private readonly repo: DynamoRepository,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private cacheKey(entityType: string): string {
    return `schema:${currentTenantId()}:${entityType}`;
  }

  async get(entityType: DynamicEntityType): Promise<EntitySchemaRecord> {
    const cached = await this.redis.get(this.cacheKey(entityType));
    if (cached) return EntitySchemaRecordSchema.parse(JSON.parse(cached));

    const record = await this.readThrough(entityType);
    await this.redis.set(this.cacheKey(entityType), JSON.stringify(record), 'EX', CACHE_TTL_SECONDS);
    return record;
  }

  private async readThrough(entityType: DynamicEntityType): Promise<EntitySchemaRecord> {
    const stored = await this.repo.get<{ version: number; fields: Record<string, FieldDefinition> }>(
      schemaSk(entityType),
    );
    return stored ? EntitySchemaRecordSchema.parse({ version: stored.version, fields: stored.fields }) : EMPTY;
  }

  async invalidate(entityType: DynamicEntityType): Promise<void> {
    await this.redis.del(this.cacheKey(entityType));
  }

  async validate(
    entityType: DynamicEntityType,
    attributes: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { fields } = await this.get(entityType);
    const result = validateAttributes(fields, attributes);
    if (!result.ok) {
      throw new ProblemException(
        'schema-validation-failed',
        422,
        'Attributes do not match the tenant schema',
        `${result.errors.length} attribute error(s)`,
        { errors: result.errors },
      );
    }
    return result.value;
  }

  /** Applies an add-only diff. Returns the new schema version. */
  async applyAddFields(entityType: DynamicEntityType, addedFields: AddedField[]): Promise<number> {
    const current = await this.readThrough(entityType);

    const conflicts = addedFields.filter((f) => f.name in current.fields).map((f) => f.name);
    if (conflicts.length > 0) {
      throw new ProblemException(
        'unsupported-schema-change',
        422,
        'Field already exists',
        `cannot add already-defined field(s): ${conflicts.join(', ')}`,
        { conflicts },
      );
    }

    const fields: Record<string, FieldDefinition> = { ...current.fields };
    for (const f of addedFields) {
      fields[f.name] = { type: f.type, required: f.required, default: f.default ?? null };
    }
    const version = current.version + 1;

    await this.repo.transactWrite([
      {
        Put: {
          TableName: this.repo.tableName,
          Item: {
            ...this.repo.key(schemaSk(entityType)),
            entityType: 'Schema',
            targetEntity: entityType,
            version,
            fields,
            updatedAt: new Date().toISOString(),
          },
          // Concurrent executions cannot both win: either the record is absent,
          // or its version is still the one we read.
          ConditionExpression: 'attribute_not_exists(PK) OR #v = :expected',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expected': current.version },
        },
      },
    ]);

    await this.invalidate(entityType);
    return version;
  }
}
```

`apps/engine/src/registry/registry.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { SchemaRegistryService } from './schema-registry.service';

@Global()
@Module({ providers: [SchemaRegistryService], exports: [SchemaRegistryService] })
export class RegistryModule {}
```

Register `RedisModule` and `RegistryModule` in `app.module.ts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, all validator and registry cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add enforcing per-tenant schema registry with redis cache"
```

---

### Task 10: Products module

**Files:**
- Create: `apps/engine/src/common/zod-validation.pipe.ts`
- Create: `apps/engine/src/products/products.service.ts`, `src/products/products.controller.ts`, `src/products/products.module.ts`, `src/products/search-provider.ts`, `src/products/dynamo-search.provider.ts`
- Test: `apps/engine/src/products/dynamo-search.provider.test.ts`, `apps/engine/test/e2e/products.e2e.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository`, `SchemaRegistryService`, `ProblemException`, `newId`, `entitySk`, `skPrefix`.
- Produces:
  - `ZodBody(schema)` — a parameter decorator applying a Zod schema to the request body
  - `SearchProvider` interface: `search(criteria: SearchProducts): Promise<Page<ProductRecord>>`
  - `SEARCH_PROVIDER` injection token
  - `buildProductFilter(criteria: SearchProducts): FilterSpec | undefined`
  - `ProductsService` with `create(input: CreateProduct): Promise<ProductRecord>`, `get(id: string): Promise<ProductRecord>`, `list(limit, cursor): Promise<Page<ProductRecord>>`, `search(criteria): Promise<Page<ProductRecord>>`
  - Routes: `POST /api/v1/products`, `GET /api/v1/products`, `GET /api/v1/products/:id`, `POST /api/v1/products/search`

- [ ] **Step 1: Write the failing unit test**

`apps/engine/src/products/dynamo-search.provider.test.ts`:

```ts
import { SearchProductsSchema } from '@marketplace/contracts';
import { buildProductFilter } from './dynamo-search.provider';

describe('buildProductFilter', () => {
  it('returns undefined when nothing is filtered', () => {
    expect(buildProductFilter(SearchProductsSchema.parse({}))).toBeUndefined();
  });

  it('filters on a core field', () => {
    const filter = buildProductFilter(SearchProductsSchema.parse({ category: 'chairs' }))!;
    expect(filter.expression).toBe('#f0 = :v0');
    expect(filter.names).toEqual({ '#f0': 'category' });
    expect(filter.values).toEqual({ ':v0': 'chairs' });
  });

  it('filters on a nested dynamic attribute', () => {
    const filter = buildProductFilter(
      SearchProductsSchema.parse({ attributes: { dietaryNeeds: 'vegan' } }),
    )!;
    expect(filter.expression).toBe('#a.#f0 = :v0');
    expect(filter.names).toEqual({ '#a': 'attributes', '#f0': 'dietaryNeeds' });
    expect(filter.values).toEqual({ ':v0': 'vegan' });
  });

  it('combines core, range and attribute filters with AND', () => {
    const filter = buildProductFilter(
      SearchProductsSchema.parse({
        status: 'active',
        priceMinorMin: 1000,
        priceMinorMax: 5000,
        attributes: { dietaryNeeds: 'vegan' },
      }),
    )!;
    expect(filter.expression.split(' AND ')).toHaveLength(4);
    expect(Object.keys(filter.values)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Write the failing e2e test**

`apps/engine/test/e2e/products.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const product = {
  name: 'Chair',
  description: 'A comfy chair',
  priceMinor: 4999,
  currency: 'INR',
  category: 'chairs',
  stock: 10,
  status: 'active',
};

describe('products', () => {
  let headersA: HeadersInit;
  let headersB: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headersA = await authHeaders('tenant_a', 'alice@example.com');
    headersB = await authHeaders('tenant_b', 'bob@example.com');
  });

  it('creates and reads back a product', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; priceMinor: number };
    expect(body.priceMinor).toBe(4999);

    const fetched = await fetch(`${baseUrl}/api/v1/products/${body.id}`, { headers: headersA });
    expect(fetched.status).toBe(200);
  });

  it('does not expose one tenant product to another', async () => {
    const created = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify(product),
    });
    const { id } = (await created.json()) as { id: string };

    const crossTenant = await fetch(`${baseUrl}/api/v1/products/${id}`, { headers: headersB });
    expect(crossTenant.status).toBe(404);
  });

  it('rejects an unknown dynamic attribute', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...product, attributes: { notDefined: 'x' } }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { type: string };
    expect(body.type).toContain('schema-validation-failed');
  });

  it('searches on a core field', async () => {
    await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ ...product, category: 'desks' }),
    });

    const res = await fetch(`${baseUrl}/api/v1/products/search`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ category: 'desks' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { category: string }[] };
    expect(body.items.every((i) => i.category === 'desks')).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('paginates the list endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/v1/products?limit=1`, { headers: headersA });
    const body = (await res.json()) as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './dynamo-search.provider'`.

- [ ] **Step 4: Implement**

`apps/engine/src/common/zod-validation.pipe.ts`:

```ts
import { ArgumentMetadata, Body, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { ProblemException } from './problem';

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ProblemException('invalid-request', 400, 'Request body is invalid', undefined, {
        errors: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

export const ZodBody = (schema: ZodSchema): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));
```

`apps/engine/src/products/search-provider.ts`:

```ts
import { Page, ProductRecord, SearchProducts } from '@marketplace/contracts';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchProvider {
  search(criteria: SearchProducts): Promise<Page<ProductRecord>>;
}
```

`apps/engine/src/products/dynamo-search.provider.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Page, ProductRecord, SearchProducts } from '@marketplace/contracts';
import { DynamoRepository, FilterSpec } from '../persistence/dynamo.repository';
import { skPrefix } from '../persistence/keys';
import { SearchProvider } from './search-provider';

export function buildProductFilter(criteria: SearchProducts): FilterSpec | undefined {
  const clauses: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  let n = 0;

  const core: Array<[string, unknown, string]> = [];
  if (criteria.category !== undefined) core.push(['category', criteria.category, '=']);
  if (criteria.status !== undefined) core.push(['status', criteria.status, '=']);
  if (criteria.priceMinorMin !== undefined) core.push(['priceMinor', criteria.priceMinorMin, '>=']);
  if (criteria.priceMinorMax !== undefined) core.push(['priceMinor', criteria.priceMinorMax, '<=']);

  for (const [field, value, op] of core) {
    names[`#f${n}`] = field;
    values[`:v${n}`] = value;
    clauses.push(`#f${n} ${op} :v${n}`);
    n++;
  }

  const attributeEntries = Object.entries(criteria.attributes);
  if (attributeEntries.length > 0) names['#a'] = 'attributes';
  for (const [field, value] of attributeEntries) {
    names[`#f${n}`] = field;
    values[`:v${n}`] = value;
    clauses.push(`#a.#f${n} = :v${n}`);
    n++;
  }

  if (clauses.length === 0) return undefined;
  return { expression: clauses.join(' AND '), names, values };
}

@Injectable()
export class DynamoSearchProvider implements SearchProvider {
  constructor(private readonly repo: DynamoRepository) {}

  search(criteria: SearchProducts): Promise<Page<ProductRecord>> {
    return this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), {
      limit: criteria.limit,
      cursor: criteria.cursor,
      filter: buildProductFilter(criteria),
    });
  }
}
```

`apps/engine/src/products/products.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { CreateProduct, Page, ProductRecord, SearchProducts } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { SEARCH_PROVIDER, SearchProvider } from './search-provider';

@Injectable()
export class ProductsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
    @Inject(SEARCH_PROVIDER) private readonly searchProvider: SearchProvider,
  ) {}

  async create(input: CreateProduct): Promise<ProductRecord> {
    const attributes = await this.registry.validate('Product', input.attributes);
    const now = new Date().toISOString();
    const id = newId();

    const record: Omit<ProductRecord, 'PK' | 'SK'> = {
      entityType: 'Product',
      id,
      status: input.status,
      name: input.name,
      description: input.description,
      priceMinor: input.priceMinor,
      currency: input.currency,
      category: input.category,
      stock: input.stock,
      images: input.images,
      createdAt: now,
      updatedAt: now,
      attributes,
    };

    await this.repo.put(entitySk('Product', id), record);
    return { ...record, ...this.repo.key(entitySk('Product', id)) };
  }

  async get(id: string): Promise<ProductRecord> {
    const found = await this.repo.get<ProductRecord>(entitySk('Product', id));
    if (!found) throw new ProblemException('not-found', 404, 'Product not found');
    return found;
  }

  list(limit: number, cursor: string | null): Promise<Page<ProductRecord>> {
    return this.repo.queryPrefix<ProductRecord>(skPrefix('Product'), { limit, cursor });
  }

  search(criteria: SearchProducts): Promise<Page<ProductRecord>> {
    return this.searchProvider.search(criteria);
  }
}
```

`apps/engine/src/products/products.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  CreateProduct,
  CreateProductSchema,
  Page,
  ProductRecord,
  SearchProducts,
  SearchProductsSchema,
} from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  create(@ZodBody(CreateProductSchema) body: CreateProduct): Promise<ProductRecord> {
    return this.products.create(body);
  }

  @Get()
  list(
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<Page<ProductRecord>> {
    return this.products.list(limit ? Number(limit) : 25, cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ProductRecord> {
    return this.products.get(id);
  }

  @Post('search')
  @HttpCode(200)
  search(@ZodBody(SearchProductsSchema) body: SearchProducts): Promise<Page<ProductRecord>> {
    return this.products.search(body);
  }
}
```

Route order matters: `@Post('search')` is declared after `@Get(':id')` but they differ by method, so there is no conflict. Nest matches `POST /products/search` before any `:id` route because `GET :id` cannot serve a POST.

`apps/engine/src/products/products.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { DynamoSearchProvider } from './dynamo-search.provider';
import { SEARCH_PROVIDER } from './search-provider';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, { provide: SEARCH_PROVIDER, useClass: DynamoSearchProvider }],
  exports: [ProductsService],
})
export class ProductsModule {}
```

Register `ProductsModule` in `app.module.ts`.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, four `buildProductFilter` cases.

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS. The cross-tenant 404 is spec e2e invariant 1.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add products module with registry-validated attributes and filtered search"
```

---

### Task 11: Events module

**Files:**
- Create: `apps/engine/src/events/events.service.ts`, `src/events/events.controller.ts`, `src/events/events.module.ts`
- Test: `apps/engine/test/e2e/events.e2e.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository`, `SchemaRegistryService`, `ZodBody`, `newId`, `entitySk`, `skPrefix`, `ProblemException`.
- Produces: `EventsService` with `create(input: CreateEvent): Promise<EventRecord>`, `get(id: string): Promise<EventRecord>`, `list(limit, cursor): Promise<Page<EventRecord>>`. Routes `POST /api/v1/events`, `GET /api/v1/events`, `GET /api/v1/events/:id`. `bookedCount` is initialized to `0` here — Task 14 depends on it existing.

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/events.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const event = {
  title: 'Workshop',
  capacity: 25,
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-09-01T17:00:00.000Z',
  basePriceMinor: 150000,
  currency: 'INR',
};

describe('events', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('creates an event with a zero booked count', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; bookedCount: number; capacity: number };
    expect(body.bookedCount).toBe(0);
    expect(body.capacity).toBe(25);
  });

  it('rejects an event whose end precedes its start', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...event, endDate: '2026-08-01T09:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/01J000000000000000000000AB`, { headers });
    expect(res.status).toBe(404);
  });

  it('lists events', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events?limit=5`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `POST /api/v1/events` returns 404.

- [ ] **Step 3: Implement**

`apps/engine/src/events/events.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CreateEvent, EventRecord, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';

@Injectable()
export class EventsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateEvent): Promise<EventRecord> {
    const attributes = await this.registry.validate('Event', input.attributes);
    const id = newId();

    const record: Omit<EventRecord, 'PK' | 'SK'> = {
      entityType: 'Event',
      id,
      title: input.title,
      capacity: input.capacity,
      bookedCount: 0,
      startDate: input.startDate,
      endDate: input.endDate,
      basePriceMinor: input.basePriceMinor,
      currency: input.currency,
      createdAt: new Date().toISOString(),
      attributes,
    };

    await this.repo.put(entitySk('Event', id), record);
    return { ...record, ...this.repo.key(entitySk('Event', id)) };
  }

  async get(id: string): Promise<EventRecord> {
    const found = await this.repo.get<EventRecord>(entitySk('Event', id));
    if (!found) throw new ProblemException('not-found', 404, 'Event not found');
    return found;
  }

  list(limit: number, cursor: string | null): Promise<Page<EventRecord>> {
    return this.repo.queryPrefix<EventRecord>(skPrefix('Event'), { limit, cursor });
  }
}
```

`apps/engine/src/events/events.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateEvent, CreateEventSchema, EventRecord, Page } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@ZodBody(CreateEventSchema) body: CreateEvent): Promise<EventRecord> {
    return this.events.create(body);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<EventRecord>> {
    return this.events.list(limit ? Number(limit) : 25, cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<EventRecord> {
    return this.events.get(id);
  }
}
```

`apps/engine/src/events/events.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({ controllers: [EventsController], providers: [EventsService], exports: [EventsService] })
export class EventsModule {}
```

Register `EventsModule` in `app.module.ts`.

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, all four event cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add events module with capacity counter initialization"
```

---

### Task 12: Idempotency

**Files:**
- Create: `apps/engine/src/idempotency/idempotency.service.ts`, `src/idempotency/idempotency.interceptor.ts`, `src/idempotency/idempotency.module.ts`
- Test: `apps/engine/src/idempotency/idempotency.service.int-test.ts`

**Interfaces:**
- Consumes: `REDIS` (Task 9), `currentTenantId`, `ProblemException`.
- Produces:
  - `IdempotencyService` with
    `begin(key: string): Promise<{ status: 'new' } | { status: 'replay'; response: unknown }>` and
    `complete(key: string, response: unknown): Promise<void>` and
    `release(key: string): Promise<void>`
  - `IdempotencyInterceptor` — reads the `Idempotency-Key` header; passes straight through when absent; replays a stored response when the key has completed; raises `request-in-progress` (409) when the key is claimed but unfinished.

- [ ] **Step 1: Write the failing integration test**

`apps/engine/src/idempotency/idempotency.service.int-test.ts`:

```ts
import Redis from 'ioredis';
import { IdempotencyService } from './idempotency.service';
import { runWithTenant } from '../common/tenant-context';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const service = new IdempotencyService(redis);

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  runWithTenant({ tenantId, userId: 'user-1', role: null }, fn);
const uniq = () => Math.random().toString(36).slice(2, 10);

afterAll(async () => {
  await redis.quit();
});

describe('IdempotencyService', () => {
  it('claims a fresh key', async () => {
    expect(await asTenant('tenant_a', () => service.begin(uniq()))).toEqual({ status: 'new' });
  });

  it('reports a claimed but unfinished key as in progress', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await expect(asTenant('tenant_a', () => service.begin(key))).rejects.toThrow(/in progress/i);
  });

  it('replays a completed response', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await asTenant('tenant_a', () => service.complete(key, { id: 'ORDER-1' }));
    expect(await asTenant('tenant_a', () => service.begin(key))).toEqual({
      status: 'replay',
      response: { id: 'ORDER-1' },
    });
  });

  it('scopes keys per tenant', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    expect(await asTenant('tenant_b', () => service.begin(key))).toEqual({ status: 'new' });
  });

  it('frees a released key for retry', async () => {
    const key = uniq();
    await asTenant('tenant_a', () => service.begin(key));
    await asTenant('tenant_a', () => service.release(key));
    expect(await asTenant('tenant_a', () => service.begin(key))).toEqual({ status: 'new' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test`
Expected: FAIL — `Cannot find module './idempotency.service'`.

- [ ] **Step 3: Implement**

`apps/engine/src/idempotency/idempotency.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { currentTenantId } from '../common/tenant-context';
import { REDIS } from '../redis/redis.module';
import { ProblemException } from '../common/problem';

const IN_PROGRESS = '__in_progress__';
const TTL_SECONDS = 24 * 60 * 60;

export type BeginResult = { status: 'new' } | { status: 'replay'; response: unknown };

@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(idempotencyKey: string): string {
    return `idem:${currentTenantId()}:${idempotencyKey}`;
  }

  async begin(idempotencyKey: string): Promise<BeginResult> {
    const key = this.key(idempotencyKey);
    const claimed = await this.redis.set(key, IN_PROGRESS, 'EX', TTL_SECONDS, 'NX');
    if (claimed === 'OK') return { status: 'new' };

    const stored = await this.redis.get(key);
    if (stored === null) return { status: 'new' };
    if (stored === IN_PROGRESS) {
      throw new ProblemException(
        'request-in-progress',
        409,
        'Request in progress',
        'a request with this Idempotency-Key is still being processed',
      );
    }
    return { status: 'replay', response: JSON.parse(stored) };
  }

  async complete(idempotencyKey: string, response: unknown): Promise<void> {
    await this.redis.set(this.key(idempotencyKey), JSON.stringify(response), 'EX', TTL_SECONDS);
  }

  async release(idempotencyKey: string): Promise<void> {
    await this.redis.del(this.key(idempotencyKey));
  }
}
```

`apps/engine/src/idempotency/idempotency.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length === 0) return next.handle();

    return from(this.idempotency.begin(key)).pipe(
      switchMap((result) => {
        if (result.status === 'replay') return of(result.response);
        return next.handle().pipe(
          tap((response) => {
            void this.idempotency.complete(key, response);
          }),
          catchError((err: unknown) => {
            // Free the key so a corrected retry is not permanently blocked.
            void this.idempotency.release(key);
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
```

`apps/engine/src/idempotency/idempotency.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Global()
@Module({
  providers: [IdempotencyService, IdempotencyInterceptor],
  exports: [IdempotencyService, IdempotencyInterceptor],
})
export class IdempotencyModule {}
```

Register `IdempotencyModule` in `app.module.ts`. The interceptor is applied per-route in Tasks 13 and 14, not globally — only order and booking creation need it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @marketplace/engine test`
Expected: PASS, all five idempotency cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add redis-backed idempotency keys with replay and in-progress detection"
```

---

### Task 13: Orders module

**Files:**
- Create: `apps/engine/src/orders/orders.service.ts`, `src/orders/orders.controller.ts`, `src/orders/orders.module.ts`
- Test: `apps/engine/test/e2e/orders.e2e.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository` (`key`, `tableName`, `get`, `transactWrite`, `queryUserIndex`), `SchemaRegistryService`, `IdempotencyInterceptor`, `failedTransactionIndexes`, `ProblemException`, `gsi1UserPk`, `gsi1UserSk`, `entitySk`, `skPrefix`, `newId`, `MAX_ORDER_LINE_ITEMS`.
- Produces: `OrdersService` with `create(input: CreateOrder): Promise<OrderRecord>`, `get(id: string): Promise<OrderRecord>`, `listForCurrentUser(limit, cursor): Promise<Page<OrderRecord>>`. Routes `POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:id`.

Transaction item ordering is load-bearing: item `i` is the stock update for line item `i`, and the final item is the order `Put`. `failedTransactionIndexes` returns positions in that same array, which is how a failure is attributed to a specific product.

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/orders.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const productBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Chair',
  description: 'A chair',
  priceMinor: 1000,
  currency: 'INR',
  category: 'chairs',
  stock: 5,
  status: 'active',
  ...overrides,
});

async function createProduct(headers: HeadersInit, overrides = {}): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers,
    body: JSON.stringify(productBody(overrides)),
  });
  return (await res.json()) as { id: string };
}

describe('orders', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('locks the unit price and decrements stock', async () => {
    const product = await createProduct(headers, { stock: 5, priceMinor: 1000 });

    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 2 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road', city: 'Bengaluru' },
      }),
    });
    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      totalAmountMinor: number;
      items: { unitPriceMinor: number }[];
    };
    expect(order.items[0].unitPriceMinor).toBe(1000);
    expect(order.totalAmountMinor).toBe(2000);

    const after = await fetch(`${baseUrl}/api/v1/products/${product.id}`, { headers });
    expect(((await after.json()) as { stock: number }).stock).toBe(3);
  });

  it('rejects an order for more stock than exists', async () => {
    const product = await createProduct(headers, { stock: 1 });
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 9 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { type: string; productId: string };
    expect(body.type).toContain('insufficient-stock');
    expect(body.productId).toBe(product.id);
  });

  it('rejects a mixed-currency order', async () => {
    const product = await createProduct(headers, { currency: 'INR' });
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 1 }],
        currency: 'USD',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { type: string }).type).toContain('mixed-currency-order');
  });

  it('rejects more than 50 line items', async () => {
    const product = await createProduct(headers);
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: Array.from({ length: 51 }, () => ({ productId: product.id, quantity: 1 })),
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { type: string }).type).toContain('too-many-line-items');
  });

  it('rejects the same product twice in one order', async () => {
    const product = await createProduct(headers);
    const res = await fetch(`${baseUrl}/api/v1/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        items: [
          { productId: product.id, quantity: 1 },
          { productId: product.id, quantity: 1 },
        ],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    });
    expect(res.status).toBe(422);
  });

  it('sells the last unit exactly once under concurrency', async () => {
    const product = await createProduct(headers, { stock: 1 });
    const body = JSON.stringify({
      items: [{ productId: product.id, quantity: 1 }],
      currency: 'INR',
      shippingAddress: { line1: '1 Road' },
    });

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        fetch(`${baseUrl}/api/v1/orders`, { method: 'POST', headers, body }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
  });

  it('replays an order for a repeated idempotency key', async () => {
    const product = await createProduct(headers, { stock: 5 });
    const key = `key-${Math.random().toString(36).slice(2)}`;
    const request = {
      method: 'POST',
      headers: { ...(headers as Record<string, string>), 'idempotency-key': key },
      body: JSON.stringify({
        items: [{ productId: product.id, quantity: 1 }],
        currency: 'INR',
        shippingAddress: { line1: '1 Road' },
      }),
    };

    const first = await fetch(`${baseUrl}/api/v1/orders`, request);
    const firstBody = (await first.json()) as { id: string };
    const second = await fetch(`${baseUrl}/api/v1/orders`, request);
    const secondBody = (await second.json()) as { id: string };

    expect(secondBody.id).toBe(firstBody.id);

    const after = await fetch(`${baseUrl}/api/v1/products/${product.id}`, { headers });
    expect(((await after.json()) as { stock: number }).stock).toBe(4);
  });

  it('lists the caller own orders', async () => {
    const res = await fetch(`${baseUrl}/api/v1/orders?limit=5`, { headers });
    expect(res.status).toBe(200);
    expect(Array.isArray(((await res.json()) as { items: unknown[] }).items)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `POST /api/v1/orders` returns 404.

- [ ] **Step 3: Implement**

`apps/engine/src/orders/orders.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  CreateOrder,
  MAX_ORDER_LINE_ITEMS,
  OrderLineItem,
  OrderRecord,
  Page,
  ProductRecord,
} from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { failedTransactionIndexes } from '../common/transaction-errors';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateOrder): Promise<OrderRecord> {
    if (input.items.length > MAX_ORDER_LINE_ITEMS) {
      throw new ProblemException(
        'too-many-line-items',
        422,
        'Too many line items',
        `an order may contain at most ${MAX_ORDER_LINE_ITEMS} line items`,
        { max: MAX_ORDER_LINE_ITEMS, received: input.items.length },
      );
    }

    const ids = input.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) {
      throw new ProblemException(
        'invalid-request',
        422,
        'Duplicate product in order',
        'each product may appear at most once; combine the quantities instead',
      );
    }

    const attributes = await this.registry.validate('Order', input.attributes);

    const products = await Promise.all(
      ids.map(async (id) => {
        const product = await this.repo.get<ProductRecord>(entitySk('Product', id));
        if (!product) {
          throw new ProblemException('invalid-request', 422, 'Unknown product', `no product ${id}`, {
            productId: id,
          });
        }
        if (product.currency !== input.currency) {
          throw new ProblemException(
            'mixed-currency-order',
            422,
            'Mixed currency order',
            `product ${id} is priced in ${product.currency}, order is in ${input.currency}`,
            { productId: id, productCurrency: product.currency, orderCurrency: input.currency },
          );
        }
        return product;
      }),
    );

    const lineItems: OrderLineItem[] = input.items.map((item, i) => ({
      productId: item.productId,
      quantity: item.quantity,
      unitPriceMinor: products[i].priceMinor,
    }));
    const totalAmountMinor = lineItems.reduce((sum, i) => sum + i.unitPriceMinor * i.quantity, 0);

    const principal = currentPrincipal();
    const id = newId();
    const createdAt = new Date().toISOString();

    const record: Omit<OrderRecord, 'PK' | 'SK'> = {
      GSI1PK: gsi1UserPk(principal.tenantId, principal.userId),
      GSI1SK: gsi1UserSk('Order', createdAt, id),
      entityType: 'Order',
      id,
      userId: principal.userId,
      status: 'confirmed',
      totalAmountMinor,
      currency: input.currency,
      items: lineItems,
      shippingAddress: input.shippingAddress,
      createdAt,
      attributes,
    };

    // Item i is the stock update for line item i; the order Put is last.
    const transactItems = [
      ...input.items.map((item, i) => ({
        Update: {
          TableName: this.repo.tableName,
          Key: this.repo.key(entitySk('Product', item.productId)),
          UpdateExpression: 'SET #stock = #stock - :qty, #updatedAt = :now',
          ConditionExpression: '#stock >= :qty AND #price = :expectedPrice',
          ExpressionAttributeNames: {
            '#stock': 'stock',
            '#price': 'priceMinor',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':qty': item.quantity,
            ':expectedPrice': products[i].priceMinor,
            ':now': createdAt,
          },
        },
      })),
      {
        Put: {
          TableName: this.repo.tableName,
          Item: { ...record, ...this.repo.key(entitySk('Order', id)) },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
    ];

    try {
      await this.repo.transactWrite(transactItems);
    } catch (err) {
      await this.explainFailure(err, input, products);
      throw err;
    }

    return { ...record, ...this.repo.key(entitySk('Order', id)) };
  }

  /** Turns a cancelled transaction into the specific problem that caused it. */
  private async explainFailure(
    err: unknown,
    input: CreateOrder,
    products: ProductRecord[],
  ): Promise<never | void> {
    const failed = failedTransactionIndexes(err);
    const lineIndex = failed.find((i) => i < input.items.length);
    if (lineIndex === undefined) return;

    const item = input.items[lineIndex];
    const expected = products[lineIndex];
    const current = await this.repo.get<ProductRecord>(entitySk('Product', item.productId));

    if (current && current.priceMinor !== expected.priceMinor) {
      throw new ProblemException(
        'price-changed',
        409,
        'Product price changed',
        `product ${item.productId} is now priced at ${current.priceMinor}`,
        { productId: item.productId, expectedPriceMinor: expected.priceMinor, currentPriceMinor: current.priceMinor },
      );
    }

    throw new ProblemException(
      'insufficient-stock',
      409,
      'Insufficient stock',
      `product ${item.productId} has ${current?.stock ?? 0} in stock, ${item.quantity} requested`,
      { productId: item.productId, available: current?.stock ?? 0, requested: item.quantity },
    );
  }

  async get(id: string): Promise<OrderRecord> {
    const found = await this.repo.get<OrderRecord>(entitySk('Order', id));
    if (!found) throw new ProblemException('not-found', 404, 'Order not found');
    return found;
  }

  listForCurrentUser(limit: number, cursor: string | null): Promise<Page<OrderRecord>> {
    return this.repo.queryUserIndex<OrderRecord>(currentPrincipal().userId, skPrefix('Order'), {
      limit,
      cursor,
    });
  }
}
```

`apps/engine/src/orders/orders.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { CreateOrder, CreateOrderSchema, OrderRecord, Page } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateOrderSchema) body: CreateOrder): Promise<OrderRecord> {
    return this.orders.create(body);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<OrderRecord>> {
    return this.orders.listForCurrentUser(limit ? Number(limit) : 25, cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<OrderRecord> {
    return this.orders.get(id);
  }
}
```

`apps/engine/src/orders/orders.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({ controllers: [OrdersController], providers: [OrdersService] })
export class OrdersModule {}
```

Register `OrdersModule` in `app.module.ts`.

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, all eight order cases. The concurrency case is spec e2e invariant 3 and the idempotency case is invariant 4.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add orders module with historical price locking and transactional stock decrement"
```

---

### Task 14: Bookings module

**Files:**
- Create: `apps/engine/src/bookings/bookings.service.ts`, `src/bookings/bookings.controller.ts`, `src/bookings/bookings.module.ts`
- Test: `apps/engine/test/e2e/bookings.e2e.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository`, `SchemaRegistryService`, `IdempotencyInterceptor`, `failedTransactionIndexes`, `ProblemException`, key builders, `newId`.
- Produces: `BookingsService` with `create(input: CreateBooking): Promise<BookingRecord>`, `get(id)`, `listForCurrentUser(limit, cursor)`. Routes `POST /api/v1/bookings`, `GET /api/v1/bookings`, `GET /api/v1/bookings/:id`.

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/bookings.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

async function createEvent(headers: HeadersInit, capacity: number): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Workshop',
      capacity,
      startDate: '2026-09-01T09:00:00.000Z',
      endDate: '2026-09-01T17:00:00.000Z',
      basePriceMinor: 150000,
      currency: 'INR',
    }),
  });
  return (await res.json()) as { id: string };
}

describe('bookings', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('books tickets and increments the event booked count', async () => {
    const event = await createEvent(headers, 10);
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 3 }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe('confirmed');

    const after = await fetch(`${baseUrl}/api/v1/events/${event.id}`, { headers });
    expect(((await after.json()) as { bookedCount: number }).bookedCount).toBe(3);
  });

  it('rejects a booking beyond capacity', async () => {
    const event = await createEvent(headers, 2);
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 3 }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { type: string }).type).toContain('event-at-capacity');
  });

  it('returns 422 for an unknown event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: '01J000000000000000000000AB', ticketQuantity: 1 }),
    });
    expect(res.status).toBe(422);
  });

  it('never oversells under concurrency', async () => {
    const event = await createEvent(headers, 1);
    const body = JSON.stringify({ eventId: event.id, ticketQuantity: 1 });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${baseUrl}/api/v1/bookings`, { method: 'POST', headers, body }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);

    const after = await fetch(`${baseUrl}/api/v1/events/${event.id}`, { headers });
    expect(((await after.json()) as { bookedCount: number }).bookedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `POST /api/v1/bookings` returns 404.

- [ ] **Step 3: Implement**

`apps/engine/src/bookings/bookings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { BookingRecord, CreateBooking, EventRecord, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, gsi1UserPk, gsi1UserSk, skPrefix } from '../persistence/keys';
import { currentPrincipal } from '../common/tenant-context';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { failedTransactionIndexes } from '../common/transaction-errors';

@Injectable()
export class BookingsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async create(input: CreateBooking): Promise<BookingRecord> {
    const event = await this.repo.get<EventRecord>(entitySk('Event', input.eventId));
    if (!event) {
      throw new ProblemException('invalid-request', 422, 'Unknown event', `no event ${input.eventId}`, {
        eventId: input.eventId,
      });
    }

    const attributes = await this.registry.validate('Booking', input.attributes);

    const principal = currentPrincipal();
    const id = newId();
    const createdAt = new Date().toISOString();

    const record: Omit<BookingRecord, 'PK' | 'SK'> = {
      GSI1PK: gsi1UserPk(principal.tenantId, principal.userId),
      GSI1SK: gsi1UserSk('Booking', createdAt, id),
      entityType: 'Booking',
      id,
      eventId: input.eventId,
      userId: principal.userId,
      status: 'confirmed',
      ticketQuantity: input.ticketQuantity,
      createdAt,
      attributes,
    };

    // Item 0 is the capacity claim; item 1 is the booking itself.
    try {
      await this.repo.transactWrite([
        {
          Update: {
            TableName: this.repo.tableName,
            Key: this.repo.key(entitySk('Event', input.eventId)),
            UpdateExpression: 'SET #booked = #booked + :qty',
            ConditionExpression: '#booked + :qty <= #capacity',
            ExpressionAttributeNames: { '#booked': 'bookedCount', '#capacity': 'capacity' },
            ExpressionAttributeValues: { ':qty': input.ticketQuantity },
          },
        },
        {
          Put: {
            TableName: this.repo.tableName,
            Item: { ...record, ...this.repo.key(entitySk('Booking', id)) },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ]);
    } catch (err) {
      if (failedTransactionIndexes(err).includes(0)) {
        const current = await this.repo.get<EventRecord>(entitySk('Event', input.eventId));
        const remaining = current ? current.capacity - current.bookedCount : 0;
        throw new ProblemException(
          'event-at-capacity',
          409,
          'Event at capacity',
          `${remaining} ticket(s) remain, ${input.ticketQuantity} requested`,
          { eventId: input.eventId, remaining, requested: input.ticketQuantity },
        );
      }
      throw err;
    }

    return { ...record, ...this.repo.key(entitySk('Booking', id)) };
  }

  async get(id: string): Promise<BookingRecord> {
    const found = await this.repo.get<BookingRecord>(entitySk('Booking', id));
    if (!found) throw new ProblemException('not-found', 404, 'Booking not found');
    return found;
  }

  listForCurrentUser(limit: number, cursor: string | null): Promise<Page<BookingRecord>> {
    return this.repo.queryUserIndex<BookingRecord>(currentPrincipal().userId, skPrefix('Booking'), {
      limit,
      cursor,
    });
  }
}
```

`apps/engine/src/bookings/bookings.controller.ts`:

```ts
import { Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { BookingRecord, CreateBooking, CreateBookingSchema, Page } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { BookingsService } from './bookings.service';

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  create(@ZodBody(CreateBookingSchema) body: CreateBooking): Promise<BookingRecord> {
    return this.bookings.create(body);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<BookingRecord>> {
    return this.bookings.listForCurrentUser(limit ? Number(limit) : 25, cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<BookingRecord> {
    return this.bookings.get(id);
  }
}
```

`apps/engine/src/bookings/bookings.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({ controllers: [BookingsController], providers: [BookingsService] })
export class BookingsModule {}
```

Register `BookingsModule` in `app.module.ts`.

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, all four booking cases. The oversell case is spec e2e invariant 2 — the single most important test in this plan.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add bookings module enforcing event capacity through a conditional transaction"
```

---

### Task 15: Flows module

**Files:**
- Create: `apps/engine/src/flows/flows.service.ts`, `src/flows/flows.controller.ts`, `src/flows/flows.module.ts`
- Test: `apps/engine/test/e2e/flows.e2e.test.ts`

**Interfaces:**
- Consumes: `DynamoRepository`, `SchemaRegistryService.applyAddFields`, `ProblemException`, `entitySk`, `skPrefix`, `newId`.
- Produces: `FlowsService` with `propose(input: CreateFlow): Promise<FlowRecord>`, `execute(id: string): Promise<FlowRecord>`, `get(id)`, `list(limit, cursor)`. Routes `POST /api/v1/flows`, `POST /api/v1/flows/:id/execute`, `GET /api/v1/flows`, `GET /api/v1/flows/:id`. `propose` is reused verbatim by the SQS consumer in Task 16.

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/flows.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const uniqueField = () => `field_${Math.random().toString(36).slice(2, 8)}`;

describe('flows', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    // A dedicated tenant keeps registry mutations from leaking into other suites.
    headers = await authHeaders(`tenant_flows_${Math.random().toString(36).slice(2, 8)}`, `flows-${Date.now()}@example.com`);
  });

  it('proposes a flow without applying it', async () => {
    const field = uniqueField();
    const res = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe('proposed');
  });

  it('rejects a destructive diff', async () => {
    const res = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string' }], removedFields: ['price'] },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('applies a flow, bumps the version and enforces the new field', async () => {
    const field = uniqueField();

    const proposed = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string', required: true }] },
      }),
    });
    const { id } = (await proposed.json()) as { id: string };

    const executed = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(executed.status).toBe(200);
    const flow = (await executed.json()) as { status: string; resultingVersion: number };
    expect(flow.status).toBe('applied');
    expect(flow.resultingVersion).toBeGreaterThan(0);

    const product = {
      name: 'Chair',
      description: 'A chair',
      priceMinor: 1000,
      currency: 'INR',
      category: 'chairs',
      stock: 1,
    };

    const missing = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify(product),
    });
    expect(missing.status).toBe(422);

    const provided = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...product, attributes: { [field]: 'vegan' } }),
    });
    expect(provided.status).toBe(201);
  });

  it('is idempotent on repeated execution', async () => {
    const field = uniqueField();
    const proposed = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Event',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    const { id } = (await proposed.json()) as { id: string };

    const first = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    const second = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });

    expect(second.status).toBe(200);
    expect(((await second.json()) as { resultingVersion: number }).resultingVersion).toBe(
      ((await first.json()) as { resultingVersion: number }).resultingVersion,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `POST /api/v1/flows` returns 404.

- [ ] **Step 3: Implement**

`apps/engine/src/flows/flows.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { CreateFlow, DynamicEntityType, FlowRecord, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';

@Injectable()
export class FlowsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  async propose(input: CreateFlow): Promise<FlowRecord> {
    const id = newId();
    const record: Omit<FlowRecord, 'PK' | 'SK'> = {
      entityType: 'Flow',
      id,
      targetEntity: input.targetEntity,
      actionType: input.actionType,
      status: 'proposed',
      blueprintDiff: input.blueprintDiff,
      createdAt: new Date().toISOString(),
      appliedAt: null,
      resultingVersion: null,
    };
    await this.repo.put(entitySk('Flow', id), record);
    return { ...record, ...this.repo.key(entitySk('Flow', id)) };
  }

  async execute(id: string): Promise<FlowRecord> {
    const flow = await this.get(id);

    if (flow.status === 'applied') return flow;
    if (flow.status === 'rejected') {
      throw new ProblemException(
        'unsupported-schema-change',
        422,
        'Flow was rejected',
        'a rejected flow cannot be executed',
      );
    }

    const resultingVersion = await this.registry.applyAddFields(
      flow.targetEntity as DynamicEntityType,
      flow.blueprintDiff.addedFields,
    );

    const applied: FlowRecord = {
      ...flow,
      status: 'applied',
      appliedAt: new Date().toISOString(),
      resultingVersion,
    };
    await this.repo.put(entitySk('Flow', id), applied);
    return applied;
  }

  async get(id: string): Promise<FlowRecord> {
    const found = await this.repo.get<FlowRecord>(entitySk('Flow', id));
    if (!found) throw new ProblemException('not-found', 404, 'Flow not found');
    return found;
  }

  list(limit: number, cursor: string | null): Promise<Page<FlowRecord>> {
    return this.repo.queryPrefix<FlowRecord>(skPrefix('Flow'), { limit, cursor });
  }
}
```

`apps/engine/src/flows/flows.controller.ts`:

```ts
import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CreateFlow, CreateFlowSchema, FlowRecord, Page } from '@marketplace/contracts';
import { ZodBody } from '../common/zod-validation.pipe';
import { FlowsService } from './flows.service';

@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @Post()
  propose(@ZodBody(CreateFlowSchema) body: CreateFlow): Promise<FlowRecord> {
    return this.flows.propose(body);
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Param('id') id: string): Promise<FlowRecord> {
    return this.flows.execute(id);
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('cursor') cursor?: string): Promise<Page<FlowRecord>> {
    return this.flows.list(limit ? Number(limit) : 25, cursor ?? null);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<FlowRecord> {
    return this.flows.get(id);
  }
}
```

`apps/engine/src/flows/flows.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({ controllers: [FlowsController], providers: [FlowsService], exports: [FlowsService] })
export class FlowsModule {}
```

Register `FlowsModule` in `app.module.ts`.

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, all four flow cases. The apply-and-enforce case is spec e2e invariant 5.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add flows module applying add-only schema changes to the tenant registry"
```

---

### Task 16: SQS consumer and project documentation

**Files:**
- Create: `apps/engine/src/messaging/sqs-consumer.service.ts`, `src/messaging/messaging.module.ts`
- Create: `README.md`
- Test: `apps/engine/test/e2e/sqs-consumer.e2e.test.ts`

**Interfaces:**
- Consumes: `ENV`, `FlowsService.propose`, `runWithTenant`, `normalizeTenantId`, `REDIS`, `EngineJobMessageSchema`.
- Produces: `SqsConsumerService` implementing `OnModuleInit` / `OnModuleDestroy`, polling `QUEUE_URL` while `SQS_CONSUMER_ENABLED` is true.

Behaviour: parse with `EngineJobMessageSchema`; a parse failure is left unacknowledged so the queue's redrive policy moves it to the DLQ after five receives. A valid message creates a Flow at `status: 'proposed'` — it is never auto-applied, which is what preserves the agent's `awaiting_confirmation` handshake. `messageId` is recorded in Redis so a redelivery does not create a second Flow.

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/sqs-consumer.e2e.test.ts`:

```ts
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:4566',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

const tenantId = `tenant_sqs_${Math.random().toString(36).slice(2, 8)}`;

async function flowsFor(headers: HeadersInit): Promise<{ items: { blueprintDiff: { addedFields: { name: string }[] } }[] }> {
  const res = await fetch(`${baseUrl}/api/v1/flows?limit=50`, { headers });
  return (await res.json()) as { items: { blueprintDiff: { addedFields: { name: string }[] } }[] };
}

async function waitForFlow(headers: HeadersInit, field: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = await flowsFor(headers);
    if (items.some((f) => f.blueprintDiff.addedFields.some((a) => a.name === field))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

describe('sqs consumer', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders(tenantId, `sqs-${Date.now()}@example.com`);
  });

  it('creates a proposed flow from a PROPOSE_FLOW message', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageGroupId: `TENANT#${tenantId}`,
        MessageBody: JSON.stringify({
          action: 'PROPOSE_FLOW',
          targetEntity: 'Event',
          tenantId: `TENANT#${tenantId}`,
          payload: { addedFields: [{ name: field, type: 'string' }] },
          metadata: { threadId: 'thread_88291' },
        }),
      }),
    );

    expect(await waitForFlow(headers, field)).toBe(true);

    const { items } = await flowsFor(headers);
    const matching = items.filter((f) => f.blueprintDiff.addedFields.some((a) => a.name === field));
    expect(matching).toHaveLength(1);
  });

  it('does not auto-apply the schema change', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageGroupId: `TENANT#${tenantId}`,
        MessageBody: JSON.stringify({
          action: 'PROPOSE_FLOW',
          targetEntity: 'Product',
          tenantId: `TENANT#${tenantId}`,
          payload: { addedFields: [{ name: field, type: 'string', required: true }] },
          metadata: { threadId: 'thread_2' },
        }),
      }),
    );
    expect(await waitForFlow(headers, field)).toBe(true);

    // The registry is untouched until a human executes the flow, so a product
    // that omits the proposed required field must still be accepted.
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Chair',
        description: 'A chair',
        priceMinor: 1000,
        currency: 'INR',
        category: 'chairs',
        stock: 1,
      }),
    });
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — no consumer exists, so `waitForFlow` returns false.

- [ ] **Step 3: Implement**

`apps/engine/src/messaging/sqs-consumer.service.ts`:

```ts
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import Redis from 'ioredis';
import { EngineJobMessageSchema } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';
import { FlowsService } from '../flows/flows.service';
import { runWithTenant } from '../common/tenant-context';
import { normalizeTenantId } from '../persistence/keys';

const DEDUPE_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly flows: FlowsService,
  ) {
    this.sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
  }

  onModuleInit(): void {
    if (!this.env.SQS_CONSUMER_ENABLED) return;
    this.running = true;
    this.loop = this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loop;
    this.sqs.destroy();
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const out = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.env.QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 5,
          }),
        );
        for (const message of out.Messages ?? []) {
          await this.handle(message);
        }
      } catch (err) {
        this.logger.error({ err }, 'sqs receive failed');
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async handle(message: Message): Promise<void> {
    const parsed = EngineJobMessageSchema.safeParse(JSON.parse(message.Body ?? '{}'));
    if (!parsed.success) {
      // Left unacknowledged on purpose: the redrive policy moves it to the DLQ.
      this.logger.error({ messageId: message.MessageId, issues: parsed.error.issues }, 'invalid job message');
      return;
    }

    const claimed = await this.redis.set(
      `sqsmsg:${message.MessageId}`,
      '1',
      'EX',
      DEDUPE_TTL_SECONDS,
      'NX',
    );

    if (claimed === 'OK') {
      const job = parsed.data;
      await runWithTenant(
        { tenantId: normalizeTenantId(job.tenantId), userId: 'system:agents', role: 'system' },
        () =>
          this.flows.propose({
            targetEntity: job.targetEntity,
            actionType: 'ADD_FIELDS',
            blueprintDiff: job.payload,
          }),
      );
      this.logger.log({ messageId: message.MessageId, tenantId: job.tenantId }, 'flow proposed');
    }

    await this.sqs.send(
      new DeleteMessageCommand({ QueueUrl: this.env.QUEUE_URL, ReceiptHandle: message.ReceiptHandle }),
    );
  }
}
```

`apps/engine/src/messaging/messaging.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { FlowsModule } from '../flows/flows.module';
import { SqsConsumerService } from './sqs-consumer.service';

@Module({ imports: [FlowsModule], providers: [SqsConsumerService] })
export class MessagingModule {}
```

Register `MessagingModule` in `app.module.ts`.

- [ ] **Step 4: Write the README**

`README.md`:

````markdown
# Marketplace

Multi-tenant commerce and booking platform. This repository currently contains
**MarketplaceEngine**, the deterministic core service.

- Design spec: `docs/superpowers/specs/2026-08-03-marketplace-engine-design.md`
- Implementation plan: `docs/superpowers/plans/2026-08-03-marketplace-engine.md`

## Layout

| Path | Contents |
|---|---|
| `apps/engine` | NestJS service: products, orders, events, bookings, flows |
| `apps/agents` | Placeholder for the LangGraph orchestrator (separate spec) |
| `packages/contracts` | Zod schemas — the single source of truth for entity shapes |
| `docker/` | Compose stack and infrastructure seeding |

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
````

- [ ] **Step 5: Run the whole suite to verify everything passes**

Run: `pnpm test`
Expected: PASS — contracts, unit and integration suites.

Run: `pnpm e2e`
Expected: PASS — health, auth, products, events, orders, bookings, flows, sqs-consumer. All five spec e2e invariants are covered: tenant isolation (Task 10), oversell (Task 14), stock race (Task 13), idempotency (Task 13), flow lifecycle (Task 15).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: consume PROPOSE_FLOW messages from SQS and document the project"
```

---

## Coverage against the spec

| Spec section | Task |
|---|---|
| §3 Repository layout, local stack | 1, 3, 4 |
| §4 Data model, keys, GSI1, registry record | 2, 3, 6, 9 |
| §4 Status enums, money as minor units | 2 |
| §5 Products, search behind `SearchProvider` | 10 |
| §5 Orders: price locking, stock condition, 50-item cap | 13 |
| §5 Bookings: capacity transaction | 14 |
| §5 Idempotency | 12 |
| §5 Flows: propose, execute, add-only | 15 |
| §5 SQS consumer, no auto-apply, DLQ, dedupe | 16 |
| §6 Auth, tenant isolation via ALS | 5, 7 |
| §7 Conventions, RFC 9457, error table, 404-not-403 | 8, 10–15 |
| §8 Deviations (no backfill, minor units, no nested objects) | 2, 9, 15, README in 16 |
| §10 Testing strategy, five e2e invariants | 10, 13, 14, 15 |
