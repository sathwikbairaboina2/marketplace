# MarketplaceAgents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MarketplaceAgents service — a LangGraph.js conversational agent that turns a multi-turn chat into a validated add-fields schema proposal and dispatches it to the Engine over SQS FIFO — running and verified entirely in local Docker Compose against a real Ollama model.

**Architecture:** A NestJS app in the same pnpm monorepo, owning no database. All conversation state lives in Redis behind a LangGraph `RedisSaver` checkpointer. Clients drive the conversation over a socket.io WebSocket authenticated by the same Cognito JWT the Engine verifies. Six graph nodes — three LLM, three deterministic — read the tenant's current schema registry from the Engine over HTTP, draft a `BlueprintDiff`, validate it in plain code, and on explicit user confirmation put one `PROPOSE_FLOW` message on `marketplace-engine-jobs.fifo`. The agent never writes to the Engine's database and never applies a schema change itself.

**Tech Stack:** Node 22, pnpm 9, Turborepo, TypeScript 5.6, NestJS 11, `@nestjs/websockets` + `@nestjs/platform-socket.io`, `@langchain/langgraph` 1.4, `@langchain/langgraph-checkpoint-redis` 1.0, `@langchain/ollama` 1.3, `@langchain/core` 1, Zod 3, `@aws-sdk/client-sqs`, `jose`, `ioredis`, `ulid`, `nestjs-pino`, Jest 29. Local infrastructure adds `ollama/ollama:0.32.5` serving `qwen2.5:7b-instruct` to the existing Compose stack.

**Spec:** `docs/superpowers/specs/2026-08-03-marketplace-agents-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-03-marketplace-engine.md`. Tasks 1 and 2 below amend that plan. **The whole Engine plan must be implemented and green before Task 1 of this plan starts** — Tasks 1 and 2 modify Engine source files that do not exist until then.

## Global Constraints

Every task's requirements implicitly include this section. The Engine plan's Global Constraints also still apply to any Engine file touched here.

- **Node 22, pnpm 9.** All packages are private, versioned `0.0.0`, and linked with `workspace:*`.
- **Docker-first.** A feature is not done until it passes against the real containers in `docker/docker-compose.yml`, including a real Ollama serving a real model. No feature may be verified only against a scripted LLM.
- **No code branches on environment.** Local and AWS differ by configuration only. Never write `if (process.env.NODE_ENV === 'production')` around infrastructure wiring.
- **Tenant identity comes only from the `custom:tenant_id` JWT claim.** Never from a socket event payload, path, query, or header.
- **No test asserts on model prose.** Assertions target phase, field names, and queue contents. A test that greps for an English sentence the model produced is a plan violation.
- **The service never puts an unvalidated body on the queue.** `EngineJobMessageSchema.parse` runs immediately before `SendMessage`, regardless of what the model produced.
- **Errors are RFC 9457 `application/problem+json`** on HTTP and the identical body on the socket `error` event. Every error carries a `traceId`.
- **Identifiers are ULIDs** (26 chars, Crockford base32), never UUIDv4.
- **TDD.** Write the failing test, run it, watch it fail for the right reason, implement minimally, run it green, commit.
- **Commit messages carry no `Co-Authored-By` trailer and no tool attribution.** Conventional Commits prefix (`feat:`, `test:`, `chore:`, `docs:`, `fix:`).
- **Queue name** is `marketplace-engine-jobs.fifo`. **Model** is `qwen2.5:7b-instruct`. **Agents port** is 3001.
- **Dynamic field types** allowed in a diff: `string`, `number`, `boolean`, `date`, and the array forms `string[]`, `number[]`, `boolean[]`, `date[]`. No nested objects.

## File Structure

```
marketplace/
├─ packages/
│  ├─ auth/                              NEW — shared, framework-free
│  │  ├─ package.json  tsconfig.json  jest.config.js
│  │  └─ src/
│  │     ├─ index.ts                     re-exports
│  │     ├─ errors.ts                    AuthError
│  │     ├─ tenant-context.ts            TenantPrincipal + AsyncLocalStorage
│  │     ├─ claims.ts                    principalFromClaims
│  │     └─ jwt-verifier.ts              createJwtVerifier (jose, framework-free)
│  └─ contracts/src/
│     └─ agent.ts                        NEW — AgentPhase, snapshot, socket payloads
├─ apps/
│  ├─ engine/src/
│  │  ├─ common/tenant-context.ts        MODIFIED — re-export of @marketplace/auth
│  │  ├─ auth/claims.ts                  MODIFIED — re-export of @marketplace/auth
│  │  ├─ auth/jwt-verifier.ts            MODIFIED — Nest wrapper over the shared verifier
│  │  ├─ auth/jwt-auth.guard.ts          MODIFIED — maps AuthError to UnauthorizedException
│  │  └─ registry/registry.controller.ts NEW — GET /schemas, GET /schemas/:entityType
│  └─ agents/                            NEW — this service
│     ├─ package.json  tsconfig.json  jest.config.js  jest-e2e.config.js
│     ├─ nest-cli.json  Dockerfile
│     ├─ src/
│     │  ├─ main.ts  app.module.ts
│     │  ├─ config/env.schema.ts  config.module.ts
│     │  ├─ common/problem.ts  problem.filter.ts  canonical-json.ts
│     │  ├─ auth/jwt-verifier.service.ts  jwt-auth.guard.ts  public.decorator.ts  auth.module.ts
│     │  ├─ redis/redis.module.ts
│     │  ├─ llm/llm.provider.ts  ollama.provider.ts  scripted.provider.ts  llm.module.ts
│     │  ├─ engine-client/engine.client.ts  engine-client.module.ts
│     │  ├─ threads/thread-registry.service.ts  threads.controller.ts  threads.module.ts
│     │  ├─ graph/state.ts  prompts.ts  nodes/*.ts  graph.service.ts  graph.module.ts
│     │  ├─ dispatch/dispatch.service.ts  dispatch.module.ts
│     │  ├─ chat/chat.gateway.ts  chat.module.ts
│     │  └─ health/health.controller.ts  health.module.ts
│     └─ test/e2e/                       setup.ts, helpers/, *.e2e.test.ts
└─ docker/docker-compose.yml             MODIFIED — ollama, ollama-init, agents
```

---

### Task 1: Shared auth package

Two services must verify the same Cognito tokens and derive tenant identity the same way. Copying the verifier would duplicate security-critical code and let it drift. This task extracts it, and moves the Engine onto it without changing Engine behaviour.

The package is deliberately framework-free — no `@nestjs/common` import — so it stays usable from a WebSocket handshake, where Nest's HTTP guard machinery does not apply. It therefore throws its own `AuthError`, and each consumer maps that to its own transport error.

**Files:**
- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/auth/jest.config.js`
- Create: `packages/auth/src/index.ts`, `src/errors.ts`, `src/tenant-context.ts`, `src/claims.ts`, `src/jwt-verifier.ts`
- Test: `packages/auth/src/claims.test.ts`
- Modify: `apps/engine/src/common/tenant-context.ts`, `apps/engine/src/auth/claims.ts`, `apps/engine/src/auth/jwt-verifier.ts`, `apps/engine/src/auth/jwt-auth.guard.ts`, `apps/engine/package.json`
- Delete: `apps/engine/src/auth/claims.test.ts` (its cases move to `packages/auth`)

**Interfaces:**
- Consumes: nothing.
- Produces, all exported from `@marketplace/auth`:
  - `class AuthError extends Error`
  - `interface TenantPrincipal { tenantId: string; userId: string; role: string | null }`
  - `runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T`
  - `enterTenant(principal: TenantPrincipal): void`
  - `currentPrincipal(): TenantPrincipal`
  - `currentTenantId(): string`
  - `principalFromClaims(claims: Record<string, unknown>): TenantPrincipal` — throws `AuthError`
  - `createJwtVerifier(opts: { jwksUri: string; issuer: string; audience: string }): { verify(token: string): Promise<TenantPrincipal> }`

- [ ] **Step 1: Write the failing test**

`packages/auth/src/claims.test.ts`:

```ts
import { AuthError } from './errors';
import { principalFromClaims } from './claims';
import { currentPrincipal, currentTenantId, runWithTenant } from './tenant-context';

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
    expect(() => principalFromClaims({ sub: 'user-1' })).toThrow(AuthError);
  });

  it('rejects a token with no subject', () => {
    expect(() => principalFromClaims({ 'custom:tenant_id': 'client_123' })).toThrow(AuthError);
  });
});

describe('tenant context', () => {
  it('exposes the principal inside a scope', () => {
    const principal = { tenantId: 'tenant_a', userId: 'user-1', role: null };
    const seen = runWithTenant(principal, () => ({
      principal: currentPrincipal(),
      tenantId: currentTenantId(),
    }));
    expect(seen).toEqual({ principal, tenantId: 'tenant_a' });
  });

  it('throws outside a scope', () => {
    expect(() => currentPrincipal()).toThrow(/no tenant context/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/auth test`
Expected: FAIL — the package does not exist, so pnpm reports `No projects matched the filters`.

- [ ] **Step 3: Create the package**

`packages/auth/package.json`:

```json
{
  "name": "@marketplace/auth",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  },
  "dependencies": { "jose": "^5.9.3" },
  "devDependencies": {
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  }
}
```

`packages/auth/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/auth/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
};
```

`packages/auth/src/errors.ts`:

```ts
/**
 * Transport-neutral authentication failure. HTTP consumers map this to 401;
 * the WebSocket gateway maps it to an `unauthorized` problem and a disconnect.
 * This package deliberately does not depend on NestJS.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}
```

`packages/auth/src/tenant-context.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantPrincipal {
  tenantId: string;
  userId: string;
  role: string | null;
}

const storage = new AsyncLocalStorage<TenantPrincipal>();

/** Wraps a callback in a tenant scope. Used by tests, the SQS consumer and socket handlers. */
export function runWithTenant<T>(principal: TenantPrincipal, fn: () => T): T {
  return storage.run(principal, fn);
}

/**
 * Binds the tenant to the current async execution and everything it spawns.
 * An HTTP guard needs this rather than runWithTenant, because a guard returns
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

`packages/auth/src/claims.ts`:

```ts
import { AuthError } from './errors';
import { TenantPrincipal } from './tenant-context';

export function principalFromClaims(claims: Record<string, unknown>): TenantPrincipal {
  const tenantId = claims['custom:tenant_id'];
  const userId = claims['sub'];
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new AuthError('token is missing the custom:tenant_id claim');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AuthError('token is missing the sub claim');
  }
  const role = claims['custom:role'];
  return { tenantId, userId, role: typeof role === 'string' ? role : null };
}
```

`packages/auth/src/jwt-verifier.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AuthError } from './errors';
import { principalFromClaims } from './claims';
import { TenantPrincipal } from './tenant-context';

export interface JwtVerifierOptions {
  jwksUri: string;
  issuer: string;
  audience: string;
}

export interface JwtVerifier {
  verify(token: string): Promise<TenantPrincipal>;
}

export function createJwtVerifier(opts: JwtVerifierOptions): JwtVerifier {
  // Lazy: createRemoteJWKSet makes no network call until the first verification,
  // and refetches on an unrecognized `kid`.
  const jwks = createRemoteJWKSet(new URL(opts.jwksUri));

  return {
    async verify(token: string): Promise<TenantPrincipal> {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: opts.issuer,
          audience: opts.audience,
        });
        return principalFromClaims(payload as Record<string, unknown>);
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError('token verification failed');
      }
    },
  };
}
```

`packages/auth/src/index.ts`:

```ts
export * from './errors';
export * from './tenant-context';
export * from './claims';
export * from './jwt-verifier';
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `pnpm install && pnpm --filter @marketplace/auth test`
Expected: PASS, six cases.

- [ ] **Step 5: Move the Engine onto the shared package**

Add to the `dependencies` of `apps/engine/package.json`:

```json
    "@marketplace/auth": "workspace:*",
```

Replace the entire contents of `apps/engine/src/common/tenant-context.ts` with a re-export, so that every existing Engine import of `../common/tenant-context` keeps working unchanged:

```ts
// The implementation lives in @marketplace/auth so the Engine and the Agents
// service share one tenant-context store and one JWT verifier.
export {
  runWithTenant,
  enterTenant,
  currentPrincipal,
  currentTenantId,
  type TenantPrincipal,
} from '@marketplace/auth';
```

Replace the entire contents of `apps/engine/src/auth/claims.ts`:

```ts
export { principalFromClaims } from '@marketplace/auth';
```

Delete `apps/engine/src/auth/claims.test.ts` — its four cases now live in `packages/auth/src/claims.test.ts`.

Replace `apps/engine/src/auth/jwt-verifier.ts` with a thin Nest wrapper:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createJwtVerifier, JwtVerifier as SharedVerifier, TenantPrincipal } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';

@Injectable()
export class JwtVerifier {
  private readonly verifier: SharedVerifier;

  constructor(@Inject(ENV) env: EnvConfig) {
    this.verifier = createJwtVerifier({
      jwksUri: env.JWKS_URI,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  }

  verify(token: string): Promise<TenantPrincipal> {
    return this.verifier.verify(token);
  }
}
```

In `apps/engine/src/auth/jwt-auth.guard.ts`, translate the transport-neutral error. Replace the verification line:

```ts
    const principal = await this.verifier.verify(header.slice('Bearer '.length));
```

with:

```ts
    let principal;
    try {
      principal = await this.verifier.verify(header.slice('Bearer '.length));
    } catch (err) {
      // @marketplace/auth is framework-free; the HTTP transport maps its
      // failure to 401 here, exactly as the socket gateway maps it to a
      // problem document and a disconnect.
      if (err instanceof AuthError) throw new UnauthorizedException(err.message);
      throw err;
    }
```

and add the import:

```ts
import { AuthError } from '@marketplace/auth';
```

- [ ] **Step 6: Run the Engine suites to verify nothing regressed**

Run: `pnpm install && pnpm build && pnpm test`
Expected: PASS. The Engine's own suites are unchanged apart from the deleted `claims.test.ts`.

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, all Engine e2e suites, including the 401 cases in `auth.e2e.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: extract jwt verification and tenant context into @marketplace/auth"
```

---

### Task 2: Engine registry read endpoint

The agent grounds its drafting on the tenant's current schema. Reading it must not mean giving a second service a DynamoDB client — that would duplicate key construction and put tenant isolation back on reviewer vigilance. The Engine exposes it instead.

An entity type the tenant has never registered is **not** an error: `SchemaRegistryService.get` already returns `{ version: 0, fields: {} }`, and that is a truthful answer meaning "no dynamic fields yet". A 404 is reserved for an entity type that is not one of the four dynamic entities at all.

**Files:**
- Create: `apps/engine/src/registry/registry.controller.ts`
- Modify: `apps/engine/src/registry/registry.module.ts`
- Test: `apps/engine/test/e2e/schemas.e2e.test.ts`

**Interfaces:**
- Consumes: `SchemaRegistryService` (Engine Task 9), `ProblemException` (Engine Task 8), `authHeaders` (Engine Task 5 e2e helper), `DynamicEntityTypeSchema` (Engine Task 2).
- Produces:
  - `GET /api/v1/schemas` → `{ items: Array<{ entityType: DynamicEntityType; version: number; fields: Record<string, FieldDefinition> }> }`
  - `GET /api/v1/schemas/:entityType` → `{ entityType, version, fields }`, 404 `not-found` when `:entityType` is not a dynamic entity type

- [ ] **Step 1: Write the failing e2e test**

`apps/engine/test/e2e/schemas.e2e.test.ts`:

```ts
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const tenantId = `tenant_schemas_${Math.random().toString(36).slice(2, 8)}`;

describe('schema registry reads', () => {
  let headers: HeadersInit;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders(tenantId, `schemas-${Date.now()}@example.com`);
  });

  it('returns an empty schema at version 0 for an unregistered entity', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entityType: 'Event', version: 0, fields: {} });
  });

  it('rejects an entity type that is not dynamic', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Flow`, { headers });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('lists every dynamic entity type', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { entityType: string }[] };
    expect(body.items.map((i) => i.entityType).sort()).toEqual([
      'Booking',
      'Event',
      'Order',
      'Product',
    ]);
  });

  it('reflects a field added by an executed flow', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;

    const created = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Event',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const executed = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(executed.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`, { headers });
    const body = (await res.json()) as { version: number; fields: Record<string, { type: string }> };
    expect(body.version).toBe(1);
    expect(body.fields[field].type).toBe('string');
  });

  it('rejects an unauthenticated read', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm docker:up && pnpm --filter @marketplace/engine test:e2e`
Expected: FAIL — `GET /api/v1/schemas/Event` returns 404 for every case because no controller is mounted.

- [ ] **Step 3: Implement the controller**

`apps/engine/src/registry/registry.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import {
  DynamicEntityType,
  DynamicEntityTypeSchema,
  FieldDefinition,
} from '@marketplace/contracts';
import { ProblemException } from '../common/problem';
import { SchemaRegistryService } from './schema-registry.service';

interface SchemaView {
  entityType: DynamicEntityType;
  version: number;
  fields: Record<string, FieldDefinition>;
}

@Controller('schemas')
export class RegistryController {
  constructor(private readonly registry: SchemaRegistryService) {}

  @Get()
  async list(): Promise<{ items: SchemaView[] }> {
    const items = await Promise.all(
      DynamicEntityTypeSchema.options.map((entityType) => this.one(entityType)),
    );
    return { items };
  }

  @Get(':entityType')
  async get(@Param('entityType') entityType: string): Promise<SchemaView> {
    const parsed = DynamicEntityTypeSchema.safeParse(entityType);
    if (!parsed.success) {
      // Not 400: from the caller's perspective there is no such schema resource.
      throw new ProblemException(
        'not-found',
        404,
        'No such schema',
        `${entityType} is not a dynamic entity type`,
      );
    }
    return this.one(parsed.data);
  }

  private async one(entityType: DynamicEntityType): Promise<SchemaView> {
    const { version, fields } = await this.registry.get(entityType);
    return { entityType, version, fields };
  }
}
```

Add the controller to `apps/engine/src/registry/registry.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { RegistryController } from './registry.controller';
import { SchemaRegistryService } from './schema-registry.service';

@Global()
@Module({
  controllers: [RegistryController],
  providers: [SchemaRegistryService],
  exports: [SchemaRegistryService],
})
export class RegistryModule {}
```

- [ ] **Step 4: Run the e2e test to verify it passes**

Run: `pnpm --filter @marketplace/engine test:e2e`
Expected: PASS, five cases in `schemas.e2e.test.ts`, and every previously passing Engine e2e suite still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: expose per-tenant schema registry reads on the engine"
```

---

### Task 3: Agent contracts

The socket protocol is a public interface: a browser client and the service must not be able to disagree about it. These shapes live in `packages/contracts` beside the entity schemas for the same reason the entity schemas live there.

**Files:**
- Create: `packages/contracts/src/agent.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/agent.test.ts`

**Interfaces:**
- Consumes: `UlidSchema` (`common.ts`), `BlueprintDiffSchema` (`flow.ts`), `DynamicEntityTypeSchema` (`registry.ts`) — all from Engine Task 2.
- Produces:
  - `AgentPhaseSchema`, `AgentPhase`
  - `ChatMessageSchema`, `ChatMessage`
  - `AgentStateSnapshotSchema`, `AgentStateSnapshot`
  - `ThreadResumeSchema`, `SendMessageSchema`, `ConfirmSchema`, `RejectSchema` and their inferred types
  - `AGENT_EVENTS` — the frozen event-name map both sides import instead of typing string literals

- [ ] **Step 1: Write the failing test**

`packages/contracts/src/agent.test.ts`:

```ts
import {
  AgentStateSnapshotSchema,
  AGENT_EVENTS,
  RejectSchema,
  SendMessageSchema,
} from './agent';

const ulid = '01J8Z5X9T7QK4W2M6N3P8R5V1C';

describe('AgentStateSnapshotSchema', () => {
  it('accepts a gathering snapshot with no draft', () => {
    const parsed = AgentStateSnapshotSchema.parse({
      threadId: ulid,
      phase: 'gathering',
      targetEntity: null,
      messages: [{ role: 'user', content: 'add a field' }],
      draftPayload: null,
      missingRequirements: ['field type'],
      validationErrors: [],
      dispatchedMessageId: null,
    });
    expect(parsed.phase).toBe('gathering');
  });

  it('accepts an awaiting_confirmation snapshot carrying a diff', () => {
    const parsed = AgentStateSnapshotSchema.parse({
      threadId: ulid,
      phase: 'awaiting_confirmation',
      targetEntity: 'Event',
      messages: [],
      draftPayload: { addedFields: [{ name: 'dietaryNeeds', type: 'string' }] },
      missingRequirements: [],
      validationErrors: [],
      dispatchedMessageId: null,
    });
    expect(parsed.draftPayload?.addedFields[0].required).toBe(false);
  });

  it('rejects an unknown phase', () => {
    expect(() =>
      AgentStateSnapshotSchema.parse({
        threadId: ulid,
        phase: 'thinking',
        targetEntity: null,
        messages: [],
        draftPayload: null,
        missingRequirements: [],
        validationErrors: [],
        dispatchedMessageId: null,
      }),
    ).toThrow();
  });
});

describe('event payloads', () => {
  it('requires a ULID thread id', () => {
    expect(() => SendMessageSchema.parse({ threadId: 'thread_1', content: 'hi' })).toThrow();
  });

  it('rejects an empty message', () => {
    expect(() => SendMessageSchema.parse({ threadId: ulid, content: '' })).toThrow();
  });

  it('allows a bare rejection', () => {
    expect(RejectSchema.parse({ threadId: ulid }).notes).toBeUndefined();
  });

  it('names every event once', () => {
    const names = Object.values(AGENT_EVENTS);
    expect(new Set(names).size).toBe(names.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/contracts test`
Expected: FAIL — `Cannot find module './agent'`.

- [ ] **Step 3: Implement**

`packages/contracts/src/agent.ts`:

```ts
import { z } from 'zod';
import { UlidSchema } from './common';
import { BlueprintDiffSchema } from './flow';
import { DynamicEntityTypeSchema } from './registry';

export const AgentPhaseSchema = z.enum([
  'gathering',
  'drafting',
  'validating',
  'awaiting_confirmation',
  'done',
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

/** What the server emits on every halt. The client renders from this and nothing else. */
export const AgentStateSnapshotSchema = z.object({
  threadId: UlidSchema,
  phase: AgentPhaseSchema,
  targetEntity: DynamicEntityTypeSchema.nullable(),
  messages: z.array(ChatMessageSchema),
  draftPayload: BlueprintDiffSchema.nullable(),
  missingRequirements: z.array(z.string()),
  validationErrors: z.array(z.string()),
  dispatchedMessageId: z.string().nullable(),
});
export type AgentStateSnapshot = z.infer<typeof AgentStateSnapshotSchema>;

export const ThreadResumeSchema = z.object({ threadId: UlidSchema });
export type ThreadResume = z.infer<typeof ThreadResumeSchema>;

export const SendMessageSchema = z.object({
  threadId: UlidSchema,
  content: z.string().min(1).max(4000),
});
export type SendMessage = z.infer<typeof SendMessageSchema>;

export const ConfirmSchema = z.object({ threadId: UlidSchema });
export type Confirm = z.infer<typeof ConfirmSchema>;

export const RejectSchema = z.object({
  threadId: UlidSchema,
  notes: z.string().max(4000).optional(),
});
export type Reject = z.infer<typeof RejectSchema>;

export const AGENT_EVENTS = {
  threadStart: 'thread.start',
  threadResume: 'thread.resume',
  message: 'message',
  confirm: 'confirm',
  reject: 'reject',
  state: 'state',
  error: 'error',
} as const;
```

Append to `packages/contracts/src/index.ts`:

```ts
export * from './agent';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @marketplace/contracts test`
Expected: PASS, seven cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add agent phase, snapshot and socket event contracts"
```

---

### Task 4: Agents skeleton, Ollama in Compose, config and health

The first task that produces a running service. It ends with a health probe that is only green when Redis, the Engine, and an Ollama that has actually pulled the configured model are all reachable — so every later task starts from a stack that is provably complete.

**Files:**
- Create: `apps/agents/package.json`, `tsconfig.json`, `jest.config.js`, `jest-e2e.config.js`, `nest-cli.json`, `Dockerfile`
- Create: `apps/agents/src/main.ts`, `src/app.module.ts`, `src/config/env.schema.ts`, `src/config/config.module.ts`, `src/common/problem.ts`, `src/common/problem.filter.ts`, `src/redis/redis.module.ts`, `src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `apps/agents/test/e2e/setup.ts`, `apps/agents/test/e2e/health.e2e.test.ts`
- Modify: `docker/docker-compose.yml`

**Interfaces:**
- Consumes: `docker/.env.generated` (Engine Task 3), `@marketplace/contracts`.
- Produces:
  - `EnvConfig`, `ENV` token, `ConfigModule`
  - `AgentProblemType` union and `ProblemException` with a `problem` body, plus `problemBody(exception, traceId, instance)` used by both the HTTP filter and the socket gateway
  - `REDIS` token and global `RedisModule`
  - a booted app on port 3001 behind global prefix `api/v1`
  - `apps/agents/test/e2e/setup.ts` exporting `agentsBaseUrl`, `engineBaseUrl`, `waitForAgentsHealthy`

- [ ] **Step 1: Write the failing e2e test**

`apps/agents/test/e2e/setup.ts`:

```ts
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../docker/.env.generated') });

export const agentsBaseUrl = process.env.AGENTS_BASE_URL ?? 'http://localhost:3001';
export const engineBaseUrl = process.env.ENGINE_BASE_URL ?? 'http://localhost:3000';

export async function waitForAgentsHealthy(timeoutMs = 300_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(`${agentsBaseUrl}/api/v1/health/ready`);
      if (res.status === 200) return;
    } catch {
      // agents not listening yet
    }
    if (Date.now() > deadline) throw new Error('agents did not become healthy');
    await new Promise((r) => setTimeout(r, 2000));
  }
}
```

The five-minute default is not padding: readiness requires Ollama to have finished pulling a 4.7GB model on a cold volume.

`apps/agents/test/e2e/health.e2e.test.ts`:

```ts
import { agentsBaseUrl, waitForAgentsHealthy } from './setup';

describe('agents health', () => {
  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  it('reports liveness', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/health/live`);
    expect(res.status).toBe(200);
  });

  it('reports readiness once redis, ollama and the engine are reachable', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ redis: 'ok', ollama: 'ok', engine: 'ok' });
  });

  it('returns problem+json for an unknown route', async () => {
    const res = await fetch(`${agentsBaseUrl}/api/v1/nope`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/agents test:e2e`
Expected: FAIL — `No projects matched the filters`, because the package does not exist yet.

- [ ] **Step 3: Create the application**

`apps/agents/package.json`:

```json
{
  "name": "@marketplace/agents",
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
    "@aws-sdk/client-sqs": "^3.665.0",
    "@langchain/core": "^1.0.0",
    "@langchain/langgraph": "^1.4.8",
    "@langchain/langgraph-checkpoint-redis": "^1.0.10",
    "@langchain/ollama": "^1.3.0",
    "@marketplace/auth": "workspace:*",
    "@marketplace/contracts": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/platform-socket.io": "^11.0.0",
    "@nestjs/websockets": "^11.0.0",
    "ioredis": "^5.4.1",
    "nestjs-pino": "^4.1.0",
    "pino-http": "^10.3.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "socket.io": "^4.8.0",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@aws-sdk/client-cognito-identity-provider": "^3.665.0",
    "@nestjs/cli": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "dotenv": "^16.4.5",
    "jest": "^29.7.0",
    "socket.io-client": "^4.8.0",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0"
  }
}
```

`apps/agents/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "baseUrl": "." },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "test/**/*"]
}
```

`apps/agents/nest-cli.json`:

```json
{ "$schema": "https://json.schemastore.org/nest-cli", "collection": "@nestjs/schematics", "sourceRoot": "src" }
```

`apps/agents/jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.(test|int-test)\\.ts$',
};
```

`apps/agents/jest-e2e.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'test/e2e',
  testRegex: '.*\\.e2e\\.test\\.ts$',
  testTimeout: 300000,
};
```

The 300s timeout is sized for real model inference on CPU, not for network flakiness.

`apps/agents/src/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.coerce.number().int().default(3001),
  AWS_REGION: z.string().default('us-east-1'),
  SQS_ENDPOINT: z.string().url().optional(),
  QUEUE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ENGINE_BASE_URL: z.string().url(),
  JWKS_URI: z.string().url(),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  OLLAMA_BASE_URL: z.string().url(),
  LLM_MODEL: z.string().default('qwen2.5:7b-instruct'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DRAFT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  THREAD_TTL_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');
```

`SQS_ENDPOINT` is optional for the same reason it is in the Engine: unset means the SDK resolves real AWS. `OLLAMA_BASE_URL` is the equivalent seam for the model — a hosted provider later changes this value and the provider implementation behind `LlmProvider`, not any calling code.

`apps/agents/src/config/config.module.ts`:

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

`apps/agents/src/common/problem.ts`:

```ts
import { HttpException } from '@nestjs/common';

/**
 * The Engine has its own copy of this shape with its own type union. They are
 * deliberately separate: the unions name different failures, and this service
 * must render the same body over two transports — HTTP responses and socket
 * `error` events — which is what `problemBody` below exists for.
 */
export type AgentProblemType =
  | 'unauthorized'
  | 'thread-not-found'
  | 'draft-attempts-exhausted'
  | 'llm-unavailable'
  | 'engine-unavailable'
  | 'dispatch-failed'
  | 'invalid-event-payload'
  | 'invalid-request'
  | 'not-found'
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
    type: AgentProblemType,
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

`apps/agents/src/common/problem.filter.ts`:

```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ProblemBody, ProblemException } from './problem';

/** Shared by the HTTP filter and the socket gateway, so both channels agree. */
export function toProblem(exception: unknown): ProblemBody {
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

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // Socket exceptions are handled inside the gateway, which needs the socket
    // instance to emit on; only HTTP reaches this filter.
    if (host.getType() !== 'http') return;

    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = (req.headers['x-request-id'] as string) ?? 'unknown';

    const body = toProblem(exception);
    if (body.status >= 500) {
      this.logger.error({ err: exception, traceId }, 'unhandled error');
    }

    res
      .status(body.status)
      .type('application/problem+json')
      .json({ ...body, instance: req.originalUrl, traceId });
  }
}
```

`apps/agents/src/redis/redis.module.ts`:

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

`apps/agents/src/health/health.controller.ts`:

```ts
import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ redis: string; ollama: string; engine: string }> {
    await this.redis.ping();

    // Not just "is ollama listening": readiness means the configured model has
    // actually been pulled, otherwise the first conversation fails at inference.
    const tags = await fetch(`${this.env.OLLAMA_BASE_URL}/api/tags`);
    const { models } = (await tags.json()) as { models: { name: string }[] };
    const present = models.some((m) => m.name === this.env.LLM_MODEL);
    if (!present) throw new Error(`model ${this.env.LLM_MODEL} is not pulled`);

    const engine = await fetch(`${this.env.ENGINE_BASE_URL}/api/v1/health/ready`);
    if (!engine.ok) throw new Error('engine is not ready');

    return { redis: 'ok', ollama: 'ok', engine: 'ok' };
  }
}
```

`apps/agents/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/agents/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';
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
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}
```

`apps/agents/src/main.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  const env = app.get<EnvConfig>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
```

`apps/agents/Dockerfile`:

```dockerfile
FROM node:22-alpine
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @marketplace/contracts build \
 && pnpm --filter @marketplace/auth build \
 && pnpm --filter @marketplace/agents build
WORKDIR /repo/apps/agents
CMD ["node", "dist/main.js"]
```

- [ ] **Step 4: Add Ollama and the agents service to Compose**

Add to `docker/docker-compose.yml` under `services:`:

```yaml
  ollama:
    image: ollama/ollama:0.32.5
    ports: ['11434:11434']
    volumes: ['ollama-models:/root/.ollama']
    healthcheck:
      test: ['CMD-SHELL', 'ollama list >/dev/null 2>&1 || exit 1']
      interval: 5s
      retries: 40

  ollama-init:
    image: ollama/ollama:0.32.5
    environment:
      OLLAMA_HOST: http://ollama:11434
    entrypoint: ['/bin/sh', '-c', 'ollama pull qwen2.5:7b-instruct']
    restart: 'no'
    depends_on:
      ollama: { condition: service_healthy }

  agents:
    build: { context: .., dockerfile: apps/agents/Dockerfile }
    ports: ['3001:3001']
    env_file: ['./.env.generated']
    environment:
      PORT: '3001'
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: local
      AWS_SECRET_ACCESS_KEY: local
      SQS_ENDPOINT: http://localstack:4566
      REDIS_URL: redis://redis:6379
      ENGINE_BASE_URL: http://engine:3000
      OLLAMA_BASE_URL: http://ollama:11434
      LLM_MODEL: qwen2.5:7b-instruct
      LOG_LEVEL: info
    depends_on:
      redis: { condition: service_healthy }
      engine: { condition: service_healthy }
      ollama-init: { condition: service_completed_successfully }
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://localhost:3001/api/v1/health/live || exit 1']
      interval: 3s
      retries: 30
```

And add to the top-level `volumes:` block, beside `cognito-data`:

```yaml
  ollama-models:
```

`ollama-init` is a separate one-shot service rather than a step inside the agents container because `service_completed_successfully` is what makes "the model is pulled" a dependency Compose enforces, instead of a race the application has to poll for.

**Expect the first `pnpm docker:up` after this change to take several minutes** while the model downloads. Subsequent runs hit the `ollama-models` volume and start in seconds. `pnpm docker:down` uses `-v`, which deletes that volume — use `docker compose -f docker/docker-compose.yml down` without `-v` between iterations to keep the model.

- [ ] **Step 5: Run the e2e test to verify it passes**

Run: `pnpm install && pnpm docker:up && pnpm --filter @marketplace/agents test:e2e`
Expected: PASS, three health cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add agents service skeleton with ollama in the local stack"
```

---

### Task 5: LLM provider port

Three of the six graph nodes call a model. They must be unit-testable without a model, and the model must be swappable for a hosted one later without touching a node. This task defines the seam and both implementations.

Every node needs *structured* output — an object matching a Zod schema — not free text. Ollama supports a JSON-schema-constrained response, and `ChatOllama.withStructuredOutput` drives it. The port exposes that as its primary method, with plain text as a secondary one for the clarifying questions the agent asks.

**Files:**
- Create: `apps/agents/src/llm/llm.provider.ts`, `src/llm/ollama.provider.ts`, `src/llm/scripted.provider.ts`, `src/llm/llm.module.ts`
- Test: `apps/agents/src/llm/scripted.provider.test.ts`, `apps/agents/src/llm/ollama.provider.int-test.ts`

**Interfaces:**
- Consumes: `ENV`, `EnvConfig`, `ProblemException` (Task 4).
- Produces:
  - `LLM` injection token
  - `interface LlmProvider { structured<T>(req: StructuredRequest<T>): Promise<T>; text(req: TextRequest): Promise<string> }`
  - `interface StructuredRequest<T> { system: string; messages: ChatMessage[]; schema: ZodType<T>; name: string }`
  - `interface TextRequest { system: string; messages: ChatMessage[] }`
  - `class OllamaLlmProvider implements LlmProvider`
  - `class ScriptedLlmProvider implements LlmProvider` with `pushStructured(value: unknown)`, `pushText(value: string)`, `reset()`

- [ ] **Step 1: Write the failing unit test**

`apps/agents/src/llm/scripted.provider.test.ts`:

```ts
import { z } from 'zod';
import { ScriptedLlmProvider } from './scripted.provider';

const Schema = z.object({ answer: z.string() });

describe('ScriptedLlmProvider', () => {
  it('returns queued structured values in order, parsed through the schema', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ answer: 'first' });
    llm.pushStructured({ answer: 'second' });

    const a = await llm.structured({ system: '', messages: [], schema: Schema, name: 'x' });
    const b = await llm.structured({ system: '', messages: [], schema: Schema, name: 'x' });
    expect([a.answer, b.answer]).toEqual(['first', 'second']);
  });

  it('rejects a queued value that does not match the schema', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ wrong: true });
    await expect(
      llm.structured({ system: '', messages: [], schema: Schema, name: 'x' }),
    ).rejects.toThrow();
  });

  it('fails loudly when the script is exhausted', async () => {
    const llm = new ScriptedLlmProvider();
    await expect(
      llm.structured({ system: '', messages: [], schema: Schema, name: 'x' }),
    ).rejects.toThrow(/scripted llm exhausted/);
  });

  it('records the requests it was given', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushText('hello');
    await llm.text({ system: 'sys', messages: [{ role: 'user', content: 'hi' }] });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toBe('sys');
  });
});
```

- [ ] **Step 2: Write the failing integration test**

`apps/agents/src/llm/ollama.provider.int-test.ts`:

```ts
import { z } from 'zod';
import { OllamaLlmProvider } from './ollama.provider';
import { EnvConfig } from '../config/env.schema';

const env = {
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  LLM_MODEL: process.env.LLM_MODEL ?? 'qwen2.5:7b-instruct',
  LLM_TEMPERATURE: 0,
  LLM_TIMEOUT_MS: 120_000,
} as EnvConfig;

jest.setTimeout(180_000);

describe('OllamaLlmProvider', () => {
  const llm = new OllamaLlmProvider(env);

  it('returns an object matching the requested schema', async () => {
    const Schema = z.object({ capital: z.string(), isCity: z.boolean() });
    const out = await llm.structured({
      system: 'Answer factual questions. Respond only with the requested fields.',
      messages: [{ role: 'user', content: 'What is the capital city of France?' }],
      schema: Schema,
      name: 'capital_answer',
    });

    // Structural assertions only. The model's wording is not under test.
    expect(typeof out.capital).toBe('string');
    expect(typeof out.isCity).toBe('boolean');
  });

  it('reports an unreachable model endpoint as llm-unavailable', async () => {
    const broken = new OllamaLlmProvider({ ...env, OLLAMA_BASE_URL: 'http://127.0.0.1:1' } as EnvConfig);
    await expect(
      broken.text({ system: '', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ problem: { status: 503 } });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './scripted.provider'`.

- [ ] **Step 4: Implement**

`apps/agents/src/llm/llm.provider.ts`:

```ts
import { ZodType } from 'zod';
import { ChatMessage } from '@marketplace/contracts';

export const LLM = Symbol('LLM');

export interface StructuredRequest<T> {
  system: string;
  messages: ChatMessage[];
  schema: ZodType<T>;
  /** Names the response object for the model; some backends surface it in the schema. */
  name: string;
}

export interface TextRequest {
  system: string;
  messages: ChatMessage[];
}

export interface LlmProvider {
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  text(req: TextRequest): Promise<string>;
}
```

`apps/agents/src/llm/ollama.provider.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ChatOllama } from '@langchain/ollama';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatMessage } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { LlmProvider, StructuredRequest, TextRequest } from './llm.provider';

function toLangChain(system: string, messages: ChatMessage[]): BaseMessage[] {
  const head: BaseMessage[] = system ? [new SystemMessage(system)] : [];
  return head.concat(
    messages.map((m) => (m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content))),
  );
}

@Injectable()
export class OllamaLlmProvider implements LlmProvider {
  private readonly model: ChatOllama;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.model = new ChatOllama({
      model: env.LLM_MODEL,
      baseUrl: env.OLLAMA_BASE_URL,
      temperature: env.LLM_TEMPERATURE,
    });
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const runnable = this.model.withStructuredOutput(req.schema, { name: req.name });
    return this.guard(() => runnable.invoke(toLangChain(req.system, req.messages)) as Promise<T>);
  }

  async text(req: TextRequest): Promise<string> {
    const message = await this.guard(() => this.model.invoke(toLangChain(req.system, req.messages)));
    return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  }

  /**
   * A model that is down or wedged must not hang a socket handler forever.
   * Both failures surface as one problem type, because the caller's recovery is
   * identical: the checkpoint is intact and the user can retry.
   */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new ProblemException('llm-unavailable', 503, 'Model timed out')),
        this.env.LLM_TIMEOUT_MS,
      ),
    );
    try {
      return await Promise.race([fn(), timeout]);
    } catch (err) {
      if (err instanceof ProblemException) throw err;
      throw new ProblemException(
        'llm-unavailable',
        503,
        'Model call failed',
        (err as Error).message,
      );
    }
  }
}
```

`apps/agents/src/llm/scripted.provider.ts`:

```ts
import { LlmProvider, StructuredRequest, TextRequest } from './llm.provider';

type RecordedCall = { system: string; messages: unknown[]; kind: 'structured' | 'text' };

/**
 * Test double. Queued values are still parsed through the caller's schema, so a
 * test cannot accidentally assert against a shape the real provider could never
 * return.
 */
export class ScriptedLlmProvider implements LlmProvider {
  private structuredQueue: unknown[] = [];
  private textQueue: string[] = [];
  readonly calls: RecordedCall[] = [];

  pushStructured(value: unknown): void {
    this.structuredQueue.push(value);
  }

  pushText(value: string): void {
    this.textQueue.push(value);
  }

  reset(): void {
    this.structuredQueue = [];
    this.textQueue = [];
    this.calls.length = 0;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    this.calls.push({ system: req.system, messages: req.messages, kind: 'structured' });
    if (this.structuredQueue.length === 0) {
      throw new Error(`scripted llm exhausted: no structured response queued for ${req.name}`);
    }
    return req.schema.parse(this.structuredQueue.shift());
  }

  async text(req: TextRequest): Promise<string> {
    this.calls.push({ system: req.system, messages: req.messages, kind: 'text' });
    if (this.textQueue.length === 0) {
      throw new Error('scripted llm exhausted: no text response queued');
    }
    return this.textQueue.shift()!;
  }
}
```

`apps/agents/src/llm/llm.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { LLM } from './llm.provider';
import { OllamaLlmProvider } from './ollama.provider';

@Global()
@Module({
  providers: [OllamaLlmProvider, { provide: LLM, useExisting: OllamaLlmProvider }],
  exports: [LLM],
})
export class LlmModule {}
```

Register `LlmModule` in `app.module.ts` after `RedisModule`.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS — four scripted cases and two Ollama cases. The Ollama suite needs the running stack; the first structured call may take tens of seconds on CPU.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add llm provider port with ollama and scripted implementations"
```

---

### Task 6: Engine client

The one place this service talks to the Engine. It forwards the caller's token rather than holding a service credential, so the Engine's own tenant isolation is what bounds every read.

**Files:**
- Create: `apps/agents/src/engine-client/engine.client.ts`, `src/engine-client/engine-client.module.ts`
- Test: `apps/agents/src/engine-client/engine.client.int-test.ts`

**Interfaces:**
- Consumes: `ENV`, `EnvConfig`, `ProblemException` (Task 4), `EntitySchemaRecordSchema`, `DynamicEntityType` (contracts).
- Produces: `EngineClient` with `getSchema(entityType: DynamicEntityType, token: string): Promise<EntitySchemaRecord>`.

- [ ] **Step 1: Write the failing integration test**

`apps/agents/src/engine-client/engine.client.int-test.ts`:

```ts
import { EngineClient } from './engine.client';
import { EnvConfig } from '../config/env.schema';
import { tokenFor } from '../../test/e2e/helpers/auth';

const env = {
  ENGINE_BASE_URL: process.env.ENGINE_BASE_URL ?? 'http://localhost:3000',
  ENGINE_TIMEOUT_MS: 10_000,
} as EnvConfig;

jest.setTimeout(60_000);

describe('EngineClient', () => {
  const client = new EngineClient(env);

  it('reads an empty registry for a fresh tenant', async () => {
    const tenantId = `tenant_ec_${Math.random().toString(36).slice(2, 8)}`;
    const token = await tokenFor(tenantId, `ec-${Date.now()}@example.com`);
    const schema = await client.getSchema('Event', token);
    expect(schema).toEqual({ version: 0, fields: {} });
  });

  it('surfaces an invalid token as unauthorized', async () => {
    await expect(client.getSchema('Event', 'not-a-token')).rejects.toMatchObject({
      problem: { status: 401 },
    });
  });

  it('surfaces an unreachable engine as engine-unavailable', async () => {
    const broken = new EngineClient({ ...env, ENGINE_BASE_URL: 'http://127.0.0.1:1' } as EnvConfig);
    await expect(broken.getSchema('Event', 'whatever')).rejects.toMatchObject({
      problem: { status: 503 },
    });
  });
});
```

This test imports the e2e auth helper because a real Cognito-local token is the only thing the Engine will accept, and the Docker-first constraint rules out faking it.

- [ ] **Step 2: Create the auth helper this service's tests need**

`apps/agents/test/e2e/helpers/auth.ts` — identical in purpose to the Engine's, pointed at the same pool:

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

  // The ID token, not the access token: Cognito only puts `custom:` attributes
  // on ID tokens without a pre-token-generation trigger.
  return res.AuthenticationResult!.IdToken!;
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './engine.client'`.

- [ ] **Step 4: Implement**

`apps/agents/src/engine-client/engine.client.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import {
  DynamicEntityType,
  EntitySchemaRecord,
  EntitySchemaRecordSchema,
} from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';

@Injectable()
export class EngineClient {
  constructor(@Inject(ENV) private readonly env: EnvConfig) {}

  async getSchema(entityType: DynamicEntityType, token: string): Promise<EntitySchemaRecord> {
    const body = await this.get(`/api/v1/schemas/${entityType}`, token);
    // The Engine returns { entityType, version, fields }; the graph only needs
    // the record shape the registry contract already describes.
    return EntitySchemaRecordSchema.parse({ version: body.version, fields: body.fields });
  }

  private async get(path: string, token: string): Promise<Record<string, any>> {
    let res: Response;
    try {
      res = await fetch(`${this.env.ENGINE_BASE_URL}${path}`, {
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(this.env.ENGINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new ProblemException(
        'engine-unavailable',
        503,
        'Engine is unreachable',
        (err as Error).message,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProblemException('unauthorized', 401, 'Engine rejected the caller token');
    }
    if (res.status === 404) {
      throw new ProblemException('not-found', 404, 'Engine has no such resource', path);
    }
    if (!res.ok) {
      // 5xx is the Engine failing, not the caller. Same recovery as unreachable.
      throw new ProblemException(
        'engine-unavailable',
        503,
        'Engine returned an error',
        `${res.status} for ${path}`,
      );
    }

    return (await res.json()) as Record<string, any>;
  }
}
```

`apps/agents/src/engine-client/engine-client.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { EngineClient } from './engine.client';

@Global()
@Module({ providers: [EngineClient], exports: [EngineClient] })
export class EngineClientModule {}
```

Register `EngineClientModule` in `app.module.ts`.

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS, three `EngineClient` cases alongside the Task 5 suites.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add read-only engine client forwarding the caller token"
```

---

### Task 7: Thread registry

The checkpointer stores conversation state keyed by thread id, but it does not know who owns a thread. Without a separate ownership record, any authenticated user who guessed a thread id would resume someone else's conversation — including another tenant's.

**Files:**
- Create: `apps/agents/src/threads/thread-registry.service.ts`
- Test: `apps/agents/src/threads/thread-registry.service.int-test.ts`

**Interfaces:**
- Consumes: `ENV`, `REDIS` (Task 4), `ProblemException` (Task 4), `TenantPrincipal` (`@marketplace/auth`).
- Produces: `ThreadRegistryService` with
  - `create(principal: TenantPrincipal): Promise<string>` — returns a new ULID thread id
  - `assertOwned(threadId: string, principal: TenantPrincipal): Promise<void>` — throws `thread-not-found` (404) when absent, expired, or owned by another tenant
  - `touch(threadId: string, principal: TenantPrincipal): Promise<void>` — asserts ownership, then refreshes the TTL. It takes the principal so an unchecked refresh is unreachable from the public API: otherwise anyone holding a leaked thread id could keep another tenant's conversation alive indefinitely, and the guarantee would rest on every future caller remembering to check first.

- [ ] **Step 1: Write the failing integration test**

`apps/agents/src/threads/thread-registry.service.int-test.ts`:

```ts
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { ThreadRegistryService } from './thread-registry.service';
import { EnvConfig } from '../config/env.schema';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { THREAD_TTL_SECONDS: 60 } as EnvConfig;
const registry = new ThreadRegistryService(env, redis);

const alice = { tenantId: 'tenant_a', userId: 'user-1', role: null };
const bob = { tenantId: 'tenant_b', userId: 'user-2', role: null };

afterAll(async () => {
  await redis.quit();
});

describe('ThreadRegistryService', () => {
  it('creates a ULID thread owned by the caller', async () => {
    const threadId = await registry.create(alice);
    expect(threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    await expect(registry.assertOwned(threadId, alice)).resolves.toBeUndefined();
  });

  it('hides a thread from another tenant', async () => {
    const threadId = await registry.create(alice);
    await expect(registry.assertOwned(threadId, bob)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('hides a thread that does not exist', async () => {
    await expect(registry.assertOwned(ulid(), alice)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('allows another user in the same tenant', async () => {
    const threadId = await registry.create(alice);
    const colleague = { tenantId: 'tenant_a', userId: 'user-9', role: null };
    await expect(registry.assertOwned(threadId, colleague)).resolves.toBeUndefined();
  });

  it('refreshes the expiry on touch', async () => {
    const threadId = await registry.create(alice);
    await redis.expire(`thread:${threadId}`, 5);
    await registry.touch(threadId, alice);
    expect(await redis.ttl(`thread:${threadId}`)).toBeGreaterThan(5);
  });

  it('refuses to refresh another tenant thread', async () => {
    const threadId = await registry.create(alice);
    await expect(registry.touch(threadId, bob)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('treats a corrupt ownership record as not found', async () => {
    const threadId = await registry.create(alice);
    await redis.set(`thread:${threadId}`, 'not json');
    await expect(registry.assertOwned(threadId, alice)).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });
});
```

The fourth case is the deliberate policy: threads are tenant-scoped, not user-scoped. The spec grants no role distinctions, so a colleague in the same tenant may continue a conversation.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './thread-registry.service'`.

- [ ] **Step 3: Implement**

`apps/agents/src/threads/thread-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { TenantPrincipal } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';
import { REDIS } from '../redis/redis.module';
import { ProblemException } from '../common/problem';

export interface ThreadOwner {
  tenantId: string;
  userId: string;
  createdAt: string;
}

@Injectable()
export class ThreadRegistryService {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private key(threadId: string): string {
    return `thread:${threadId}`;
  }

  async create(principal: TenantPrincipal): Promise<string> {
    const threadId = ulid();
    const owner: ThreadOwner = {
      tenantId: principal.tenantId,
      userId: principal.userId,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(
      this.key(threadId),
      JSON.stringify(owner),
      'EX',
      this.env.THREAD_TTL_SECONDS,
    );
    return threadId;
  }

  async assertOwned(threadId: string, principal: TenantPrincipal): Promise<void> {
    const stored = await this.redis.get(this.key(threadId));
    const owner = stored ? (JSON.parse(stored) as ThreadOwner) : null;

    // Absent, expired and another tenant's are one outcome on purpose: a
    // distinguishable error would confirm that the thread exists.
    if (!owner || owner.tenantId !== principal.tenantId) {
      throw new ProblemException('thread-not-found', 404, 'No such thread', threadId);
    }
  }

  /**
   * Ownership is asserted here rather than left to the caller. A bare TTL
   * refresh would let anyone holding a leaked thread id keep another tenant's
   * conversation alive indefinitely, and this is the one class of gap this
   * service exists to close — so the public API must make that unreachable
   * rather than rely on every future caller remembering to check first.
   */
  async touch(threadId: string, principal: TenantPrincipal): Promise<void> {
    await this.assertOwned(threadId, principal);
    await this.redis.expire(this.key(threadId), this.env.THREAD_TTL_SECONDS);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS, five thread registry cases.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add redis-backed thread ownership registry"
```

---

### Task 8: Graph state, checkpointer, intent and registry nodes

The first half of the state machine, ending in a graph that persists across runs. Two design points that everything after depends on:

**Halting is ending a run, not `interrupt()`.** Every client event is one `graph.invoke` that runs from `START` until it either finishes the work or reaches a point where it needs the user. Conversation state survives between runs because the checkpointer holds it. This is simpler than resumable interrupts and behaves identically from the client's side, and it makes reconnection free — a socket drop loses nothing, because no run was in flight.

**The caller's token never enters state or config.** Both are checkpointed to Redis, and a stored JWT is a stored credential. Nodes receive a `RunContext` captured when the graph is built for that run.

**Files:**
- Create: `apps/agents/src/graph/state.ts`, `src/graph/context.ts`, `src/graph/prompts.ts`, `src/graph/checkpointer.ts`
- Create: `apps/agents/src/graph/nodes/analyze-intent.node.ts`, `src/graph/nodes/load-registry.node.ts`
- Create: `apps/agents/src/graph/graph.service.ts`, `src/graph/graph.module.ts`
- Test: `apps/agents/src/graph/state.test.ts`, `src/graph/nodes/analyze-intent.node.test.ts`, `src/graph/nodes/load-registry.node.test.ts`, `src/graph/graph.service.int-test.ts`

**Interfaces:**
- Consumes: `LLM`/`LlmProvider`, `ScriptedLlmProvider` (Task 5), `EngineClient` (Task 6), `ENV` (Task 4), contracts from Task 3.
- Produces:
  - `AgentAnnotation`, `type AgentState`, `type PendingAction = 'message' | 'confirm' | 'reject'`
  - `toSnapshot(threadId: string, state: AgentState): AgentStateSnapshot`
  - `interface RunContext { principal: TenantPrincipal; authToken: string }`
  - `makeAnalyzeIntentNode(deps: { llm: LlmProvider }): (state: AgentState) => Promise<Partial<AgentState>>`
  - `makeLoadRegistryNode(deps: { engine: EngineClient }, ctx: RunContext): (state: AgentState) => Promise<Partial<AgentState>>`
  - `createCheckpointer(env: EnvConfig): Promise<RedisSaver>`
  - `GraphService` with `run(input: { threadId: string; ctx: RunContext; action: PendingAction; content?: string }): Promise<AgentStateSnapshot>` and `snapshot(threadId: string): Promise<AgentStateSnapshot>`

- [ ] **Step 1: Write the failing unit tests**

`apps/agents/src/graph/state.test.ts`:

```ts
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { toSnapshot, AgentState } from './state';

const threadId = '01J8Z5X9T7QK4W2M6N3P8R5V1C';

const base: AgentState = {
  messages: [],
  phase: 'gathering',
  targetEntity: null,
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: null,
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('toSnapshot', () => {
  it('maps langchain messages to contract chat messages', () => {
    const snapshot = toSnapshot(threadId, {
      ...base,
      messages: [new HumanMessage('add a field'), new AIMessage('which entity?')],
    });
    expect(snapshot.messages).toEqual([
      { role: 'user', content: 'add a field' },
      { role: 'assistant', content: 'which entity?' },
    ]);
  });

  it('omits internal-only state from the client view', () => {
    const snapshot = toSnapshot(threadId, { ...base, draftAttempts: 2, registrySnapshot: { version: 3, fields: {} } });
    expect(snapshot).not.toHaveProperty('draftAttempts');
    expect(snapshot).not.toHaveProperty('registrySnapshot');
    expect(snapshot).not.toHaveProperty('pendingAction');
  });

  it('produces a snapshot that satisfies the published contract', () => {
    expect(() => AgentStateSnapshotSchema.parse(toSnapshot(threadId, base))).not.toThrow();
  });
});
```

`apps/agents/src/graph/nodes/analyze-intent.node.test.ts`:

```ts
import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeAnalyzeIntentNode } from './analyze-intent.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('I want to track dietary needs on events')],
  phase: 'gathering',
  targetEntity: null,
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: null,
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('analyzeIntentNode', () => {
  it('sets the target entity when the model identifies one', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });

    const out = await makeAnalyzeIntentNode({ llm })(base);
    expect(out.targetEntity).toBe('Event');
    expect(out.phase).toBe('drafting');
  });

  it('halts at gathering with a question when no entity is identified', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type should this apply to?' });

    const out = await makeAnalyzeIntentNode({ llm })(base);
    expect(out.targetEntity).toBeNull();
    expect(out.phase).toBe('gathering');
    expect(out.messages).toHaveLength(1);
  });

  it('keeps an entity already established earlier in the conversation', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ targetEntity: 'none', clarification: 'unclear' });

    const out = await makeAnalyzeIntentNode({ llm })({ ...base, targetEntity: 'Product' });
    expect(out.targetEntity).toBe('Product');
    expect(out.phase).toBe('drafting');
  });
});
```

The third case matters: a follow-up like "make it required" carries no entity of its own, and re-asking would trap the conversation in a loop.

`apps/agents/src/graph/nodes/load-registry.node.test.ts`:

```ts
import { makeLoadRegistryNode } from './load-registry.node';
import { AgentState } from '../state';
import { EngineClient } from '../../engine-client/engine.client';

const ctx = {
  principal: { tenantId: 'tenant_a', userId: 'user-1', role: null },
  authToken: 'token-abc',
};

const base: AgentState = {
  messages: [],
  phase: 'drafting',
  targetEntity: 'Event',
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: null,
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('loadRegistryNode', () => {
  it('loads the tenant schema using the caller token', async () => {
    const getSchema = jest.fn().mockResolvedValue({ version: 2, fields: { seats: { type: 'number', required: true, default: null } } });
    const engine = { getSchema } as unknown as EngineClient;

    const out = await makeLoadRegistryNode({ engine }, ctx)(base);
    expect(getSchema).toHaveBeenCalledWith('Event', 'token-abc');
    expect(out.registrySnapshot).toMatchObject({ version: 2 });
  });

  it('refuses to run without a target entity', async () => {
    const engine = { getSchema: jest.fn() } as unknown as EngineClient;
    await expect(makeLoadRegistryNode({ engine }, ctx)({ ...base, targetEntity: null })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Write the failing integration test**

`apps/agents/src/graph/graph.service.int-test.ts`:

```ts
import { ulid } from 'ulid';
import { ScriptedLlmProvider } from '../llm/scripted.provider';
import { EngineClient } from '../engine-client/engine.client';
import { GraphService } from './graph.service';
import { createCheckpointer } from './checkpointer';
import { EnvConfig } from '../config/env.schema';

const env = {
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  DRAFT_MAX_ATTEMPTS: 3,
  THREAD_TTL_SECONDS: 3600,
} as EnvConfig;

const ctx = {
  principal: { tenantId: 'tenant_a', userId: 'user-1', role: null },
  authToken: 'token-abc',
};

jest.setTimeout(60_000);

describe('GraphService persistence', () => {
  let llm: ScriptedLlmProvider;
  let service: GraphService;

  beforeAll(async () => {
    llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    service = new GraphService(env, llm, engine, await createCheckpointer(env));
  });

  it('halts at gathering and remembers the conversation across runs', async () => {
    const threadId = ulid();

    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type?' });
    const first = await service.run({ threadId, ctx, action: 'message', content: 'I need a new field' });
    expect(first.phase).toBe('gathering');
    expect(first.messages).toHaveLength(2);

    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    const second = await service.run({ threadId, ctx, action: 'message', content: 'events' });
    expect(second.targetEntity).toBe('Event');
    // The first exchange is still there: nothing was lost between runs.
    expect(second.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('reads a thread back without running the graph', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type?' });
    await service.run({ threadId, ctx, action: 'message', content: 'hello' });

    const snapshot = await service.snapshot(threadId);
    expect(snapshot.threadId).toBe(threadId);
    expect(snapshot.phase).toBe('gathering');
  });

  it('keeps threads independent', async () => {
    const a = ulid();
    const b = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    await service.run({ threadId: a, ctx, action: 'message', content: 'events' });

    const snapshot = await service.snapshot(b);
    expect(snapshot.messages).toEqual([]);
  });
});
```

At this point the graph stops after `loadRegistry`, so a run that identifies an entity ends there. The remaining nodes arrive in Task 9.

- [ ] **Step 3: Run both to verify they fail**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './state'`.

- [ ] **Step 4: Implement**

`apps/agents/src/graph/state.ts`:

```ts
import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import {
  AgentPhase,
  AgentStateSnapshot,
  BlueprintDiff,
  ChatMessage,
  DynamicEntityType,
  EntitySchemaRecord,
} from '@marketplace/contracts';

export type PendingAction = 'message' | 'confirm' | 'reject';

const replace = <T>(defaultValue: () => T) =>
  Annotation<T>({ reducer: (_current: T, next: T) => next, default: defaultValue });

export const AgentAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  phase: replace<AgentPhase>(() => 'gathering'),
  targetEntity: replace<DynamicEntityType | null>(() => null),
  draftPayload: replace<BlueprintDiff | null>(() => null),
  missingRequirements: replace<string[]>(() => []),
  registrySnapshot: replace<EntitySchemaRecord | null>(() => null),
  validationErrors: replace<string[]>(() => []),
  draftAttempts: replace<number>(() => 0),
  dispatchedMessageId: replace<string | null>(() => null),
  pendingAction: replace<PendingAction>(() => 'message'),
});

export type AgentState = typeof AgentAnnotation.State;

function toChatMessage(message: BaseMessage): ChatMessage {
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
  return { role: message.getType() === 'human' ? 'user' : 'assistant', content };
}

/** What the LLM nodes send as conversation history. */
export function toChatMessages(messages: BaseMessage[] | undefined): ChatMessage[] {
  return (messages ?? []).map(toChatMessage);
}

/**
 * The client view. `registrySnapshot`, `draftAttempts` and `pendingAction` are
 * deliberately absent: they are how the graph works, not what the user decided.
 */
export function toSnapshot(threadId: string, state: AgentState): AgentStateSnapshot {
  return {
    threadId,
    phase: state.phase,
    targetEntity: state.targetEntity,
    messages: toChatMessages(state.messages),
    draftPayload: state.draftPayload,
    missingRequirements: state.missingRequirements,
    validationErrors: state.validationErrors,
    dispatchedMessageId: state.dispatchedMessageId,
  };
}
```

`apps/agents/src/graph/context.ts`:

```ts
import { TenantPrincipal } from '@marketplace/auth';

/**
 * Per-run identity. Held in a closure rather than in graph state or config,
 * because both of those are written to Redis by the checkpointer and a
 * persisted bearer token is a persisted credential.
 */
export interface RunContext {
  principal: TenantPrincipal;
  authToken: string;
}
```

`apps/agents/src/graph/prompts.ts`:

```ts
export const INTENT_SYSTEM = `You classify a business user's request about extending a data schema.
Decide which record type the request is about: Product, Order, Event or Booking.
If the request does not clearly indicate one, answer "none" and write one short question
asking which record type they mean. Otherwise leave the clarification empty.`;

export const REQUIREMENT_SYSTEM = `You decide whether a request to add fields to a record type
is specific enough to act on. It is specific enough when, for every field the user wants, you know
the field name and its data type (string, number, boolean, date, or an array of those).
List anything still missing, and write one short question asking for exactly that.
The fields already defined for this record type are given; ignore requests for fields that exist.`;

export const DRAFT_SYSTEM = `You translate a business user's request into a list of fields to add.
Use camelCase names starting with a letter. Choose the narrowest fitting type from:
string, number, boolean, date, string[], number[], boolean[], date[].
Only add fields the user actually asked for. Never remove or change an existing field.
If previous validation errors are given, fix exactly those problems.`;
```

`apps/agents/src/graph/nodes/analyze-intent.node.ts`:

```ts
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { DynamicEntityType } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { INTENT_SYSTEM } from '../prompts';

// 'none' rather than a nullable field: small models emit enum members far more
// reliably than they emit JSON null.
const IntentSchema = z.object({
  targetEntity: z.enum(['Product', 'Order', 'Event', 'Booking', 'none']),
  clarification: z.string(),
});

export function makeAnalyzeIntentNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    // A follow-up turn ("make it required") carries no entity of its own.
    // Re-deriving it would trap the conversation in a clarification loop.
    if (state.targetEntity) {
      return { targetEntity: state.targetEntity, phase: 'drafting' };
    }

    const intent = await deps.llm.structured({
      system: INTENT_SYSTEM,
      messages: toChatMessages(state.messages),
      schema: IntentSchema,
      name: 'intent',
    });

    if (intent.targetEntity === 'none') {
      const question = intent.clarification.trim() || 'Which record type should this apply to?';
      return {
        targetEntity: null,
        phase: 'gathering',
        missingRequirements: ['target record type'],
        messages: [new AIMessage(question)],
      };
    }

    return { targetEntity: intent.targetEntity as DynamicEntityType, phase: 'drafting', missingRequirements: [] };
  };
}
```

`apps/agents/src/graph/nodes/load-registry.node.ts`:

```ts
import { EngineClient } from '../../engine-client/engine.client';
import { RunContext } from '../context';
import { AgentState } from '../state';

export function makeLoadRegistryNode(deps: { engine: EngineClient }, ctx: RunContext) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.targetEntity) {
      // Unreachable through the graph's edges; an explicit failure beats a
      // silent request for schema "null".
      throw new Error('loadRegistry requires a target entity');
    }

    const registrySnapshot = await deps.engine.getSchema(state.targetEntity, ctx.authToken);
    return { registrySnapshot };
  };
}
```

`apps/agents/src/graph/checkpointer.ts`:

```ts
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { EnvConfig } from '../config/env.schema';

export const CHECKPOINTER = Symbol('CHECKPOINTER');

/**
 * Conversations expire with the same TTL as their ownership record, so a thread
 * never outlives the record that says who may resume it.
 */
export function createCheckpointer(env: EnvConfig): Promise<RedisSaver> {
  return RedisSaver.fromUrl(env.REDIS_URL, {
    defaultTTL: Math.floor(env.THREAD_TTL_SECONDS / 60),
    refreshOnRead: true,
  });
}
```

`defaultTTL` is expressed in minutes by the saver, which is why it is divided here.

`apps/agents/src/graph/graph.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { HumanMessage } from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { LLM, LlmProvider } from '../llm/llm.provider';
import { EngineClient } from '../engine-client/engine.client';
import { AgentAnnotation, AgentState, PendingAction, toSnapshot } from './state';
import { RunContext } from './context';
import { CHECKPOINTER } from './checkpointer';
import { makeAnalyzeIntentNode } from './nodes/analyze-intent.node';
import { makeLoadRegistryNode } from './nodes/load-registry.node';

export interface RunInput {
  threadId: string;
  ctx: RunContext;
  action: PendingAction;
  content?: string;
}

@Injectable()
export class GraphService {
  constructor(
    @Inject(ENV) private readonly env: EnvConfig,
    @Inject(LLM) private readonly llm: LlmProvider,
    private readonly engine: EngineClient,
    @Inject(CHECKPOINTER) private readonly checkpointer: RedisSaver,
  ) {}

  /**
   * Built per run rather than once, so nodes can close over the caller's
   * identity without it being written to the checkpoint. Compiling a handful of
   * nodes is cheap next to a single model call.
   */
  private build(ctx: RunContext) {
    const graph = new StateGraph(AgentAnnotation)
      .addNode('analyzeIntent', makeAnalyzeIntentNode({ llm: this.llm }))
      .addNode('loadRegistry', makeLoadRegistryNode({ engine: this.engine }, ctx))
      .addEdge(START, 'analyzeIntent')
      .addConditionalEdges('analyzeIntent', (state: AgentState) =>
        state.targetEntity ? 'loadRegistry' : END,
      )
      .addEdge('loadRegistry', END);

    return graph.compile({ checkpointer: this.checkpointer });
  }

  async run(input: RunInput): Promise<AgentStateSnapshot> {
    const app = this.build(input.ctx);
    const config = { configurable: { thread_id: input.threadId } };

    await app.invoke(
      {
        pendingAction: input.action,
        ...(input.content ? { messages: [new HumanMessage(input.content)] } : {}),
      },
      config,
    );

    return this.snapshot(input.threadId);
  }

  async snapshot(threadId: string): Promise<AgentStateSnapshot> {
    const app = this.build({ principal: { tenantId: '', userId: '', role: null }, authToken: '' });
    const state = await app.getState({ configurable: { thread_id: threadId } });
    return toSnapshot(threadId, state.values as AgentState);
  }
}
```

`snapshot` builds with an empty context on purpose: reading state runs no node, so no node can use it.

`apps/agents/src/graph/graph.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ENV, EnvConfig } from '../config/env.schema';
import { CHECKPOINTER, createCheckpointer } from './checkpointer';
import { GraphService } from './graph.service';

@Module({
  providers: [
    GraphService,
    { provide: CHECKPOINTER, inject: [ENV], useFactory: (env: EnvConfig) => createCheckpointer(env) },
  ],
  exports: [GraphService],
})
export class GraphModule {}
```

Register `GraphModule` in `app.module.ts`.

- [ ] **Step 5: Run the suites to verify they pass**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS — three snapshot cases, three intent cases, two registry cases, three persistence cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add agent graph state, redis checkpointer, intent and registry nodes"
```

---

### Task 9: Requirement, drafting and validation nodes

The middle of the graph, and the only place where a model's output is turned into something the Engine could act on. The validation node is deliberately plain code: it is the last line of defence before a schema proposal, and it must behave identically every run.

**Files:**
- Create: `apps/agents/src/graph/nodes/requirement-check.node.ts`, `src/graph/nodes/draft-schema.node.ts`, `src/graph/nodes/validate.node.ts`, `src/graph/core-fields.ts`
- Modify: `apps/agents/src/graph/graph.service.ts`
- Test: `apps/agents/src/graph/nodes/requirement-check.node.test.ts`, `src/graph/nodes/draft-schema.node.test.ts`, `src/graph/nodes/validate.node.test.ts`, `src/graph/graph.service.int-test.ts`

**Interfaces:**
- Consumes: everything from Task 8, plus `BlueprintDiffSchema`, `FieldTypeSchema` (contracts).
- Produces:
  - `CORE_FIELDS: Record<DynamicEntityType, readonly string[]>`
  - `makeRequirementCheckNode(deps: { llm: LlmProvider })`
  - `makeDraftSchemaNode(deps: { llm: LlmProvider })`
  - `makeValidateNode(deps: { maxAttempts: number })`
  - graph edges wiring `loadRegistry → requirementCheck → draftSchema → validate`

- [ ] **Step 1: Write the failing unit tests**

`apps/agents/src/graph/nodes/requirement-check.node.test.ts`:

```ts
import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeRequirementCheckNode } from './requirement-check.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('track dietary needs on events')],
  phase: 'drafting',
  targetEntity: 'Event',
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('requirementCheckNode', () => {
  it('proceeds to drafting when the request is specific enough', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ satisfied: true, missing: [], question: '' });

    const out = await makeRequirementCheckNode({ llm })(base);
    expect(out.phase).toBe('drafting');
    expect(out.missingRequirements).toEqual([]);
  });

  it('halts at gathering and asks for what is missing', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({
      satisfied: false,
      missing: ['data type of dietaryNeeds'],
      question: 'Should dietary needs be free text or a list?',
    });

    const out = await makeRequirementCheckNode({ llm })(base);
    expect(out.phase).toBe('gathering');
    expect(out.missingRequirements).toEqual(['data type of dietaryNeeds']);
    expect(out.messages).toHaveLength(1);
  });

  it('shows the model the fields that already exist', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ satisfied: true, missing: [], question: '' });

    await makeRequirementCheckNode({ llm })({
      ...base,
      registrySnapshot: { version: 1, fields: { seats: { type: 'number', required: true, default: null } } },
    });
    expect(llm.calls[0].system).toContain('seats');
  });
});
```

`apps/agents/src/graph/nodes/draft-schema.node.test.ts`:

```ts
import { HumanMessage } from '@langchain/core/messages';
import { ScriptedLlmProvider } from '../../llm/scripted.provider';
import { makeDraftSchemaNode } from './draft-schema.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [new HumanMessage('add dietaryNeeds as text')],
  phase: 'drafting',
  targetEntity: 'Event',
  draftPayload: null,
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 0,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

describe('draftSchemaNode', () => {
  it('builds a blueprint diff and applies contract defaults', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    const out = await makeDraftSchemaNode({ llm })(base);
    expect(out.draftPayload).toEqual({
      addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }],
    });
    expect(out.phase).toBe('validating');
    expect(out.draftAttempts).toBe(1);
  });

  it('feeds previous validation errors back to the model', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    await makeDraftSchemaNode({ llm })({
      ...base,
      draftAttempts: 1,
      validationErrors: ['dietaryNeeds already exists'],
    });
    const prompt = llm.calls[0].system;
    expect(prompt).toContain('dietaryNeeds already exists');
  });

  it('counts attempts cumulatively', async () => {
    const llm = new ScriptedLlmProvider();
    llm.pushStructured({ addedFields: [{ name: 'x', type: 'string', required: false }] });

    const out = await makeDraftSchemaNode({ llm })({ ...base, draftAttempts: 2 });
    expect(out.draftAttempts).toBe(3);
  });
});
```

`apps/agents/src/graph/nodes/validate.node.test.ts`:

```ts
import { makeValidateNode } from './validate.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [],
  phase: 'validating',
  targetEntity: 'Event',
  draftPayload: { addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }] },
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 1,
  dispatchedMessageId: null,
  pendingAction: 'message',
};

const validate = makeValidateNode({ maxAttempts: 3 });

describe('validateNode', () => {
  it('accepts a clean add-fields diff and awaits confirmation', async () => {
    const out = await validate(base);
    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.validationErrors).toEqual([]);
    expect(out.messages).toHaveLength(1);
  });

  it('rejects a field that already exists in the registry', async () => {
    const out = await validate({
      ...base,
      registrySnapshot: {
        version: 1,
        fields: { dietaryNeeds: { type: 'string', required: false, default: null } },
      },
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors[0]).toContain('dietaryNeeds');
  });

  it('rejects a name that collides with a core field', async () => {
    const out = await validate({
      ...base,
      draftPayload: { addedFields: [{ name: 'capacity', type: 'number', required: false, default: null }] },
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors[0]).toContain('capacity');
  });

  it('rejects a diff that fails the contract schema', async () => {
    const out = await validate({
      ...base,
      draftPayload: { addedFields: [] } as never,
    });
    expect(out.phase).toBe('drafting');
    expect(out.validationErrors.length).toBeGreaterThan(0);
  });

  it('gives up at the attempt ceiling instead of looping', async () => {
    const out = await validate({
      ...base,
      draftAttempts: 3,
      registrySnapshot: {
        version: 1,
        fields: { dietaryNeeds: { type: 'string', required: false, default: null } },
      },
    });
    expect(out.phase).toBe('gathering');
    expect(out.draftPayload).toBeNull();
    expect(out.draftAttempts).toBe(0);
    expect(out.messages).toHaveLength(1);
  });
});
```

The last case is the whole reason the bound exists: without it, a model that cannot satisfy the request redrafts forever and the socket never gets an answer.

- [ ] **Step 2: Extend the graph integration test**

Append to `apps/agents/src/graph/graph.service.int-test.ts`:

```ts
describe('GraphService full drafting path', () => {
  let llm: ScriptedLlmProvider;
  let service: GraphService;

  beforeAll(async () => {
    llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    service = new GraphService(env, llm, engine, await createCheckpointer(env));
  });

  it('runs intent to awaiting_confirmation in one pass', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    const out = await service.run({
      threadId,
      ctx,
      action: 'message',
      content: 'add a dietaryNeeds text field to events',
    });

    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.draftPayload).toEqual({
      addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }],
    });
  });

  it('redrafts once after a validation failure, then succeeds', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    // First draft collides with a core field; second one does not.
    llm.pushStructured({ addedFields: [{ name: 'capacity', type: 'number', required: false }] });
    llm.pushStructured({ addedFields: [{ name: 'extraSeats', type: 'number', required: false }] });

    const out = await service.run({ threadId, ctx, action: 'message', content: 'more seats' });
    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.draftPayload?.addedFields[0].name).toBe('extraSeats');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './requirement-check.node'`.

- [ ] **Step 4: Implement**

`apps/agents/src/graph/core-fields.ts`:

```ts
import { DynamicEntityType } from '@marketplace/contracts';

/**
 * Core field names per entity, from the Engine's contracts. A dynamic attribute
 * with one of these names is not technically ambiguous — attributes live in
 * their own map — but it is confusing enough in every downstream query and
 * report that the agent refuses to propose one.
 */
export const CORE_FIELDS: Record<DynamicEntityType, readonly string[]> = {
  Product: [
    'PK', 'SK', 'entityType', 'id', 'status', 'name', 'description', 'priceMinor',
    'currency', 'category', 'stock', 'images', 'createdAt', 'updatedAt', 'attributes',
  ],
  Order: [
    'PK', 'SK', 'entityType', 'id', 'userId', 'status', 'totalAmountMinor', 'currency',
    'items', 'shippingAddress', 'createdAt', 'attributes',
  ],
  Event: [
    'PK', 'SK', 'entityType', 'id', 'title', 'capacity', 'bookedCount', 'startDate',
    'endDate', 'basePriceMinor', 'currency', 'createdAt', 'attributes',
  ],
  Booking: [
    'PK', 'SK', 'entityType', 'id', 'eventId', 'userId', 'status', 'ticketQuantity',
    'createdAt', 'attributes',
  ],
};
```

`apps/agents/src/graph/nodes/requirement-check.node.ts`:

```ts
import { z } from 'zod';
import { AIMessage } from '@langchain/core/messages';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { REQUIREMENT_SYSTEM } from '../prompts';

const RequirementSchema = z.object({
  satisfied: z.boolean(),
  missing: z.array(z.string()),
  question: z.string(),
});

function describeRegistry(state: AgentState): string {
  const fields = state.registrySnapshot?.fields ?? {};
  const names = Object.entries(fields).map(([name, def]) => `${name}: ${def.type}`);
  return names.length > 0 ? names.join(', ') : 'none';
}

export function makeRequirementCheckNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const result = await deps.llm.structured({
      system: `${REQUIREMENT_SYSTEM}\n\nRecord type: ${state.targetEntity}\nExisting fields: ${describeRegistry(state)}`,
      messages: toChatMessages(state.messages),
      schema: RequirementSchema,
      name: 'requirements',
    });

    if (result.satisfied) {
      return { phase: 'drafting', missingRequirements: [] };
    }

    const question = result.question.trim() || 'Could you give the field name and its data type?';
    return {
      phase: 'gathering',
      missingRequirements: result.missing,
      messages: [new AIMessage(question)],
    };
  };
}
```

`apps/agents/src/graph/nodes/draft-schema.node.ts`:

```ts
import { z } from 'zod';
import { BlueprintDiff, FieldTypeSchema } from '@marketplace/contracts';
import { LlmProvider } from '../../llm/llm.provider';
import { AgentState, toChatMessages } from '../state';
import { DRAFT_SYSTEM } from '../prompts';

// Not BlueprintDiffSchema directly: its `default: unknown().nullable()` has no
// useful JSON-schema form for a constrained decode, and `.strict()` adds an
// additionalProperties rule small models handle poorly. The narrow shape is
// widened to the real contract below, where the defaults come from.
const DraftSchema = z.object({
  addedFields: z
    .array(z.object({ name: z.string(), type: FieldTypeSchema, required: z.boolean() }))
    .min(1),
});

export function makeDraftSchemaNode(deps: { llm: LlmProvider }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const corrections =
      state.validationErrors.length > 0
        ? `\n\nThe previous attempt was rejected for these reasons:\n- ${state.validationErrors.join('\n- ')}`
        : '';

    const draft = await deps.llm.structured({
      system: `${DRAFT_SYSTEM}\n\nRecord type: ${state.targetEntity}${corrections}`,
      messages: toChatMessages(state.messages),
      schema: DraftSchema,
      name: 'blueprint_diff',
    });

    const draftPayload: BlueprintDiff = {
      addedFields: draft.addedFields.map((f) => ({
        name: f.name,
        type: f.type,
        required: f.required,
        default: null,
      })),
    };

    return { draftPayload, phase: 'validating', draftAttempts: state.draftAttempts + 1 };
  };
}
```

`apps/agents/src/graph/nodes/validate.node.ts`:

```ts
import { AIMessage } from '@langchain/core/messages';
import { BlueprintDiffSchema } from '@marketplace/contracts';
import { AgentState } from '../state';
import { CORE_FIELDS } from '../core-fields';

function describeDiff(state: AgentState): string {
  const fields = state.draftPayload?.addedFields ?? [];
  return fields.map((f) => `${f.name} (${f.type}${f.required ? ', required' : ''})`).join(', ');
}

export function makeValidateNode(deps: { maxAttempts: number }) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const errors: string[] = [];

    const parsed = BlueprintDiffSchema.safeParse(state.draftPayload);
    if (!parsed.success) {
      errors.push(...parsed.error.issues.map((i) => `${i.path.join('.') || 'diff'}: ${i.message}`));
    } else {
      const existing = state.registrySnapshot?.fields ?? {};
      const core = state.targetEntity ? CORE_FIELDS[state.targetEntity] : [];

      for (const field of parsed.data.addedFields) {
        if (field.name in existing) {
          errors.push(`${field.name} already exists on ${state.targetEntity}`);
        }
        if (core.includes(field.name)) {
          errors.push(`${field.name} collides with a built-in field of ${state.targetEntity}`);
        }
      }
    }

    if (errors.length === 0) {
      return {
        phase: 'awaiting_confirmation',
        validationErrors: [],
        messages: [
          new AIMessage(
            `Ready to propose adding ${describeDiff(state)} to ${state.targetEntity}. Confirm to send it for approval.`,
          ),
        ],
      };
    }

    // The bound is what turns "loop back to drafting" from a hang into an answer.
    if (state.draftAttempts >= deps.maxAttempts) {
      return {
        phase: 'gathering',
        draftPayload: null,
        draftAttempts: 0,
        validationErrors: errors,
        messages: [
          new AIMessage(
            `I could not produce a valid change after ${deps.maxAttempts} attempts: ${errors.join('; ')}. Could you restate what you need?`,
          ),
        ],
      };
    }

    return { phase: 'drafting', validationErrors: errors };
  };
}
```

Rewrite the `build` method of `apps/agents/src/graph/graph.service.ts`:

```ts
  private build(ctx: RunContext) {
    const graph = new StateGraph(AgentAnnotation)
      .addNode('analyzeIntent', makeAnalyzeIntentNode({ llm: this.llm }))
      .addNode('loadRegistry', makeLoadRegistryNode({ engine: this.engine }, ctx))
      .addNode('requirementCheck', makeRequirementCheckNode({ llm: this.llm }))
      .addNode('draftSchema', makeDraftSchemaNode({ llm: this.llm }))
      .addNode('validate', makeValidateNode({ maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }))
      .addEdge(START, 'analyzeIntent')
      .addConditionalEdges('analyzeIntent', (state: AgentState) =>
        state.targetEntity ? 'loadRegistry' : END,
      )
      .addEdge('loadRegistry', 'requirementCheck')
      .addConditionalEdges('requirementCheck', (state: AgentState) =>
        state.phase === 'gathering' ? END : 'draftSchema',
      )
      .addEdge('draftSchema', 'validate')
      .addConditionalEdges('validate', (state: AgentState) =>
        state.phase === 'drafting' ? 'draftSchema' : END,
      );

    return graph.compile({ checkpointer: this.checkpointer });
  }
```

Add the three node imports at the top of the file.

- [ ] **Step 5: Run the suites to verify they pass**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS — three requirement cases, three drafting cases, five validation cases, and five graph integration cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add requirement, drafting and bounded validation nodes"
```

---

### Task 10: Dispatch and confirmation

The write side. Everything up to here produced a proposal; this task sends it, exactly once, and closes the loop on the user's explicit decision.

**Files:**
- Create: `apps/agents/src/common/canonical-json.ts`, `src/dispatch/dispatch.service.ts`, `src/dispatch/dispatch.module.ts`
- Create: `apps/agents/src/graph/nodes/dispatch.node.ts`, `src/graph/nodes/apply-rejection.node.ts`
- Modify: `apps/agents/src/graph/graph.service.ts`, `src/app.module.ts`
- Test: `apps/agents/src/common/canonical-json.test.ts`, `src/dispatch/dispatch.service.int-test.ts`, `src/graph/nodes/apply-rejection.node.test.ts`

**Interfaces:**
- Consumes: `ENV`, `ProblemException`, `EngineJobMessageSchema` (contracts), `RunContext`.
- Produces:
  - `canonicalJson(value: unknown): string` — key-sorted, stable
  - `DispatchService.dispatch(args: { threadId: string; tenantId: string; targetEntity: DynamicEntityType; payload: BlueprintDiff }): Promise<string>` returning the SQS message id
  - `makeDispatchNode(deps: { dispatch: DispatchService }, ctx: RunContext)`
  - `makeApplyRejectionNode()`
  - entry routing that sends `confirm` to dispatch and `reject` to the rejection node

- [ ] **Step 1: Write the failing unit tests**

`apps/agents/src/common/canonical-json.test.ts`:

```ts
import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  it('is insensitive to key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it('sorts nested object keys too', () => {
    expect(canonicalJson({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array order, which is meaningful', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('distinguishes different values', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
});
```

`apps/agents/src/graph/nodes/apply-rejection.node.test.ts`:

```ts
import { makeApplyRejectionNode } from './apply-rejection.node';
import { AgentState } from '../state';

const base: AgentState = {
  messages: [],
  phase: 'awaiting_confirmation',
  targetEntity: 'Event',
  draftPayload: { addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }] },
  missingRequirements: [],
  registrySnapshot: { version: 0, fields: {} },
  validationErrors: [],
  draftAttempts: 1,
  dispatchedMessageId: null,
  pendingAction: 'reject',
};

describe('applyRejectionNode', () => {
  it('ends the thread on a bare rejection', async () => {
    const out = await makeApplyRejectionNode()(base);
    expect(out.phase).toBe('done');
    expect(out.draftPayload).toBeNull();
  });

  it('returns to gathering when the user supplied revision notes', async () => {
    const out = await makeApplyRejectionNode()({
      ...base,
      messages: [{ getType: () => 'human', content: 'make it a list instead' } as never],
    });
    expect(out.phase).toBe('gathering');
    expect(out.draftPayload).toBeNull();
    expect(out.draftAttempts).toBe(0);
  });
});
```

Notes arrive as an ordinary user message appended by the gateway before the run, so the node's rule is "a rejection that came with a new message resumes gathering; one that did not is final".

- [ ] **Step 2: Write the failing integration test**

`apps/agents/src/dispatch/dispatch.service.int-test.ts`:

```ts
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { ulid } from 'ulid';
import { EngineJobMessageSchema } from '@marketplace/contracts';
import { DispatchService } from './dispatch.service';
import { EnvConfig } from '../config/env.schema';

const env = {
  AWS_REGION: 'us-east-1',
  SQS_ENDPOINT: process.env.SQS_ENDPOINT ?? 'http://localhost:4566',
  QUEUE_URL: process.env.QUEUE_URL!,
} as EnvConfig;

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: env.SQS_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

jest.setTimeout(60_000);

async function drain(predicate: (body: any) => boolean): Promise<any[]> {
  const found: any[] = [];
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const out = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: env.QUEUE_URL, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }),
    );
    for (const m of out.Messages ?? []) {
      const body = JSON.parse(m.Body!);
      if (predicate(body)) found.push(body);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: env.QUEUE_URL, ReceiptHandle: m.ReceiptHandle! }));
    }
    if (found.length > 0) break;
  }
  return found;
}

describe('DispatchService', () => {
  const service = new DispatchService(env);

  it('puts a contract-valid PROPOSE_FLOW message on the queue', async () => {
    const threadId = ulid();
    const field = `f_${Math.random().toString(36).slice(2, 8)}`;

    await service.dispatch({
      threadId,
      tenantId: 'tenant_disp',
      targetEntity: 'Event',
      payload: { addedFields: [{ name: field, type: 'string', required: false, default: null }] },
    });

    const [body] = await drain((b) => b?.payload?.addedFields?.[0]?.name === field);
    expect(body).toBeDefined();
    expect(() => EngineJobMessageSchema.parse(body)).not.toThrow();
    expect(body.tenantId).toBe('TENANT#tenant_disp');
    expect(body.metadata.threadId).toBe(threadId);
  });

  it('rejects a payload the engine contract would not accept', async () => {
    await expect(
      service.dispatch({
        threadId: ulid(),
        tenantId: 'tenant_disp',
        targetEntity: 'Event',
        payload: { addedFields: [] } as never,
      }),
    ).rejects.toThrow();
  });

  it('produces a stable deduplication id for the same thread and payload', () => {
    const args = {
      threadId: '01J8Z5X9T7QK4W2M6N3P8R5V1C',
      payload: { addedFields: [{ name: 'a', type: 'string' as const, required: false, default: null }] },
    };
    expect(DispatchService.deduplicationId(args.threadId, args.payload)).toBe(
      DispatchService.deduplicationId(args.threadId, args.payload),
    );
    expect(DispatchService.deduplicationId('01J8Z5X9T7QK4W2M6N3P8R5V1D', args.payload)).not.toBe(
      DispatchService.deduplicationId(args.threadId, args.payload),
    );
  });
});
```

This test consumes from the shared queue. Run it while the Engine's consumer is also running and the Engine will simply propose a Flow for the same message — which is the intended behaviour, not interference.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter @marketplace/agents test`
Expected: FAIL — `Cannot find module './canonical-json'`.

- [ ] **Step 4: Implement**

`apps/agents/src/common/canonical-json.ts`:

```ts
/**
 * Stable stringification: object keys sorted, array order preserved. Used to
 * derive a deduplication id that is identical for the same logical proposal
 * however the object was assembled.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}
```

`apps/agents/src/dispatch/dispatch.service.ts`:

```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import {
  BlueprintDiff,
  DynamicEntityType,
  EngineJobMessage,
  EngineJobMessageSchema,
} from '@marketplace/contracts';
import { ENV, EnvConfig } from '../config/env.schema';
import { ProblemException } from '../common/problem';
import { canonicalJson } from '../common/canonical-json';

export interface DispatchArgs {
  threadId: string;
  tenantId: string;
  targetEntity: DynamicEntityType;
  payload: BlueprintDiff;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private readonly sqs: SQSClient;

  constructor(@Inject(ENV) private readonly env: EnvConfig) {
    this.sqs = new SQSClient({ region: env.AWS_REGION, endpoint: env.SQS_ENDPOINT });
  }

  /**
   * Derived rather than random, so a retried dispatch — after a socket drop or
   * a resumed thread — collapses into the original inside the FIFO queue's
   * five-minute deduplication window instead of proposing twice.
   */
  static deduplicationId(threadId: string, payload: BlueprintDiff): string {
    return createHash('sha256').update(`${threadId}:${canonicalJson(payload)}`).digest('hex');
  }

  async dispatch(args: DispatchArgs): Promise<string> {
    const groupId = `TENANT#${args.tenantId}`;

    // Parsed, not cast: whatever the model produced, an unparseable body never
    // reaches the queue.
    const body: EngineJobMessage = EngineJobMessageSchema.parse({
      action: 'PROPOSE_FLOW',
      targetEntity: args.targetEntity,
      tenantId: groupId,
      payload: args.payload,
      metadata: { threadId: args.threadId },
    });

    try {
      const out = await this.sqs.send(
        new SendMessageCommand({
          QueueUrl: this.env.QUEUE_URL,
          // The tenant, per the PRD: schema updates for one tenant stay ordered.
          MessageGroupId: groupId,
          MessageDeduplicationId: DispatchService.deduplicationId(args.threadId, args.payload),
          MessageBody: JSON.stringify(body),
        }),
      );
      this.logger.log({ threadId: args.threadId, tenantId: args.tenantId, messageId: out.MessageId }, 'flow proposed');
      return out.MessageId!;
    } catch (err) {
      throw new ProblemException('dispatch-failed', 502, 'Could not queue the proposal', (err as Error).message);
    }
  }
}
```

`apps/agents/src/dispatch/dispatch.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';

@Global()
@Module({ providers: [DispatchService], exports: [DispatchService] })
export class DispatchModule {}
```

`apps/agents/src/graph/nodes/dispatch.node.ts`:

```ts
import { AIMessage } from '@langchain/core/messages';
import { DispatchService } from '../../dispatch/dispatch.service';
import { RunContext } from '../context';
import { AgentState } from '../state';

export function makeDispatchNode(deps: { dispatch: DispatchService }, ctx: RunContext) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    if (!state.draftPayload || !state.targetEntity) {
      throw new Error('dispatch requires a validated draft');
    }

    // Already sent: a duplicate confirm must not produce a second proposal.
    if (state.dispatchedMessageId) {
      return { phase: 'done' };
    }

    const messageId = await deps.dispatch.dispatch({
      threadId: ctx.threadId,
      tenantId: ctx.principal.tenantId,
      targetEntity: state.targetEntity,
      payload: state.draftPayload,
    });

    return {
      phase: 'done',
      dispatchedMessageId: messageId,
      messages: [
        new AIMessage(
          'Sent for approval. It will appear as a proposed change that an administrator can apply.',
        ),
      ],
    };
  };
}
```

This needs the thread id, so extend `RunContext` in `apps/agents/src/graph/context.ts`:

```ts
import { TenantPrincipal } from '@marketplace/auth';

export interface RunContext {
  principal: TenantPrincipal;
  authToken: string;
  threadId: string;
}
```

and set it wherever a `RunContext` is constructed — `GraphService.run` passes `input.threadId`, and the existing unit tests gain `threadId: '01J8Z5X9T7QK4W2M6N3P8R5V1C'` in their `ctx` literals.

`apps/agents/src/graph/nodes/apply-rejection.node.ts`:

```ts
import { AIMessage } from '@langchain/core/messages';
import { AgentState } from '../state';

export function makeApplyRejectionNode() {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const last = state.messages[state.messages.length - 1];
    const hasNotes = last?.getType() === 'human';

    if (!hasNotes) {
      return {
        phase: 'done',
        draftPayload: null,
        draftAttempts: 0,
        validationErrors: [],
        messages: [new AIMessage('Discarded. Nothing was sent.')],
      };
    }

    return {
      phase: 'gathering',
      draftPayload: null,
      draftAttempts: 0,
      validationErrors: [],
    };
  };
}
```

Rewrite `build` in `apps/agents/src/graph/graph.service.ts` once more, adding the two nodes and the entry router:

```ts
  private build(ctx: RunContext) {
    const graph = new StateGraph(AgentAnnotation)
      .addNode('analyzeIntent', makeAnalyzeIntentNode({ llm: this.llm }))
      .addNode('loadRegistry', makeLoadRegistryNode({ engine: this.engine }, ctx))
      .addNode('requirementCheck', makeRequirementCheckNode({ llm: this.llm }))
      .addNode('draftSchema', makeDraftSchemaNode({ llm: this.llm }))
      .addNode('validate', makeValidateNode({ maxAttempts: this.env.DRAFT_MAX_ATTEMPTS }))
      .addNode('dispatch', makeDispatchNode({ dispatch: this.dispatch }, ctx))
      .addNode('applyRejection', makeApplyRejectionNode())
      // A confirmation is a decision, not a sentence to interpret: it routes
      // straight to dispatch without any model in the path.
      .addConditionalEdges(START, (state: AgentState) => {
        if (state.phase === 'awaiting_confirmation' && state.pendingAction === 'confirm') return 'dispatch';
        if (state.phase === 'awaiting_confirmation' && state.pendingAction === 'reject') return 'applyRejection';
        return 'analyzeIntent';
      })
      .addConditionalEdges('analyzeIntent', (state: AgentState) =>
        state.targetEntity ? 'loadRegistry' : END,
      )
      .addEdge('loadRegistry', 'requirementCheck')
      .addConditionalEdges('requirementCheck', (state: AgentState) =>
        state.phase === 'gathering' ? END : 'draftSchema',
      )
      .addEdge('draftSchema', 'validate')
      .addConditionalEdges('validate', (state: AgentState) =>
        state.phase === 'drafting' ? 'draftSchema' : END,
      )
      .addEdge('dispatch', END)
      .addEdge('applyRejection', END);

    return graph.compile({ checkpointer: this.checkpointer });
  }
```

Inject `DispatchService` into `GraphService`'s constructor after `engine`, and pass `threadId` when building in `run`:

```ts
  async run(input: RunInput): Promise<AgentStateSnapshot> {
    const app = this.build({ ...input.ctx, threadId: input.threadId });
    ...
```

`snapshot` also builds a graph, so its placeholder context needs the new field. It stays empty because reading state runs no node:

```ts
  async snapshot(threadId: string): Promise<AgentStateSnapshot> {
    const app = this.build({
      principal: { tenantId: '', userId: '', role: null },
      authToken: '',
      threadId,
    });
    const state = await app.getState({ configurable: { thread_id: threadId } });
    return toSnapshot(threadId, state.values as AgentState);
  }
```

`RunInput.ctx` is now `Omit<RunContext, 'threadId'>`, since the thread id is already a sibling field on the input — update the interface accordingly.

Register `DispatchModule` in `app.module.ts` before `GraphModule`.

- [ ] **Step 5: Add the confirmation integration case**

Append to `apps/agents/src/graph/graph.service.int-test.ts`:

```ts
describe('GraphService confirmation', () => {
  it('dispatches exactly once even if confirm arrives twice', async () => {
    const llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-1') };
    const service = new GraphService(env, llm, engine, dispatch as never, await createCheckpointer(env));

    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });
    await service.run({ threadId, ctx, action: 'message', content: 'add dietaryNeeds text to events' });

    const first = await service.run({ threadId, ctx, action: 'confirm' });
    const second = await service.run({ threadId, ctx, action: 'confirm' });

    expect(first.phase).toBe('done');
    expect(second.phase).toBe('done');
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
  });
});
```

Adjust the constructor argument order in the earlier `GraphService` constructions in this file to match the new signature.

- [ ] **Step 6: Run the suites to verify they pass**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test`
Expected: PASS — four canonical-json cases, two rejection cases, three dispatch cases, and the graph suites including the double-confirm case.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: dispatch confirmed proposals to the engine queue with derived deduplication"
```

---

### Task 11: WebSocket gateway and thread reads

The client-facing surface. Two things carry the security weight here: the handshake is the only place a token is accepted, and every handler asserts thread ownership before touching the graph.

**Files:**
- Create: `apps/agents/src/auth/jwt-verifier.service.ts`, `src/auth/public.decorator.ts`, `src/auth/jwt-auth.guard.ts`, `src/auth/request-principal.ts`, `src/auth/tenant-context.interceptor.ts`, `src/auth/auth.module.ts`
- Create: `apps/agents/src/chat/chat.gateway.ts`, `src/chat/chat.module.ts`
- Create: `apps/agents/src/threads/threads.controller.ts`, `src/threads/threads.module.ts`
- Modify: `apps/agents/src/app.module.ts`, `src/health/health.controller.ts`
- Test: `apps/agents/test/e2e/helpers/socket.ts`, `apps/agents/test/e2e/chat.e2e.test.ts`

**Interfaces:**
- Consumes: `createJwtVerifier`, `runWithTenant`, `AuthError` (`@marketplace/auth`); `GraphService` (Task 10); `ThreadRegistryService` (Task 7); `toProblem` (Task 4); agent contracts (Task 3).
- Produces:
  - `JwtVerifierService` with `verify(token: string): Promise<TenantPrincipal>`
  - `@Public()` and a global `JwtAuthGuard` for the HTTP surface
  - `ChatGateway` on namespace `/agents`
  - `GET /api/v1/threads/:id` returning an `AgentStateSnapshot`
  - e2e helpers `connectSocket(token)`, `waitForState(socket, predicate)`, `waitForError(socket)`

- [ ] **Step 1: Write the failing e2e test**

`apps/agents/test/e2e/helpers/socket.ts`:

```ts
import { io, Socket } from 'socket.io-client';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { agentsBaseUrl } from '../setup';

export function connectSocket(token: string): Promise<Socket> {
  const socket = io(`${agentsBaseUrl}/agents`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket did not connect')), 15_000);
  });
}

export function waitForState(
  socket: Socket,
  predicate: (s: AgentStateSnapshot) => boolean = () => true,
  timeoutMs = 240_000,
): Promise<AgentStateSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for state')), timeoutMs);
    const onState = (snapshot: AgentStateSnapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off('state', onState);
      resolve(snapshot);
    };
    socket.on('state', onState);
  });
}

export function waitForError(socket: Socket, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for error')), timeoutMs);
    socket.once('error', (problem: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(problem);
    });
  });
}
```

`apps/agents/test/e2e/chat.e2e.test.ts`:

```ts
import { Socket } from 'socket.io-client';
import { agentsBaseUrl, waitForAgentsHealthy } from './setup';
import { tokenFor } from './helpers/auth';
import { connectSocket, waitForError, waitForState } from './helpers/socket';

const tenantA = `tenant_chat_a_${Math.random().toString(36).slice(2, 8)}`;
const tenantB = `tenant_chat_b_${Math.random().toString(36).slice(2, 8)}`;

describe('chat gateway', () => {
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  async function open(tenantId: string): Promise<Socket> {
    const token = await tokenFor(tenantId, `chat-${tenantId}@example.com`);
    const socket = await connectSocket(token);
    sockets.push(socket);
    return socket;
  }

  it('refuses a connection with no token', async () => {
    // Handshake middleware rejects, so this surfaces as `connect_error` rather
    // than a connection that opens and is then closed.
    await expect(connectSocket('')).rejects.toBeDefined();
  });

  it('refuses a connection with a malformed token', async () => {
    await expect(connectSocket('not-a-jwt')).rejects.toBeDefined();
  });

  it('starts a thread and returns an empty snapshot', async () => {
    const socket = await open(tenantA);
    const pending = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const snapshot = await pending;

    expect(snapshot.threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(snapshot.phase).toBe('gathering');
    expect(snapshot.messages).toEqual([]);
  });

  it('rejects an event payload that fails its contract', async () => {
    const socket = await open(tenantA);
    const pending = waitForError(socket);
    socket.emit('message', { threadId: 'not-a-ulid', content: 'hi' });
    const problem = await pending;
    expect(problem.status).toBe(422);
  });

  it('hides another tenant thread behind thread-not-found', async () => {
    const a = await open(tenantA);
    const started = waitForState(a, () => true, 15_000);
    a.emit('thread.start', {});
    const { threadId } = await started;

    const b = await open(tenantB);
    const pending = waitForError(b);
    b.emit('thread.resume', { threadId });
    const problem = await pending;

    expect(problem.status).toBe(404);
    expect(problem.type).toContain('thread-not-found');
  });

  it('serves the same snapshot over HTTP', async () => {
    const socket = await open(tenantA);
    const started = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const { threadId } = await started;

    const token = await tokenFor(tenantA, `chat-${tenantA}@example.com`);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${threadId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ threadId, phase: 'gathering' });
  });

  it('refuses an HTTP thread read from another tenant', async () => {
    const socket = await open(tenantA);
    const started = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const { threadId } = await started;

    const token = await tokenFor(tenantB, `chat-${tenantB}@example.com`);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${threadId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
```

None of these run the model: they exercise the transport, auth and ownership rules, which are deterministic. The model-driven flows are Task 12.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test:e2e`
Expected: FAIL — the socket never connects, because no gateway is mounted.

- [ ] **Step 3: Implement auth**

`apps/agents/src/auth/jwt-verifier.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { createJwtVerifier, JwtVerifier, TenantPrincipal } from '@marketplace/auth';
import { ENV, EnvConfig } from '../config/env.schema';

@Injectable()
export class JwtVerifierService {
  private readonly verifier: JwtVerifier;

  constructor(@Inject(ENV) env: EnvConfig) {
    this.verifier = createJwtVerifier({
      jwksUri: env.JWKS_URI,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });
  }

  verify(token: string): Promise<TenantPrincipal> {
    return this.verifier.verify(token);
  }
}
```

`apps/agents/src/auth/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`apps/agents/src/auth/jwt-auth.guard.ts`:

**Do not call `enterTenant` from this guard.** The Engine hit this exact problem and worked around it; `apps/engine/src/auth/jwt-auth.guard.ts`, `request-principal.ts` and `tenant-context.interceptor.ts` carry the full explanation. In short: Nest's guards consumer awaits the guard's promise from a continuation scheduled *before* `verify()` resolved, so an `AsyncLocalStorage.enterWith()` performed after that `await` is never observed by the controller. `GET /threads/:id` calls `currentPrincipal()`, so it would throw "no tenant context" at runtime while every unit test passed.

Mirror the Engine: the guard stashes the principal on the request, and an interceptor binds the async scope at the point Nest wraps the continuation with `AsyncResource.bind`.

```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthError } from '@marketplace/auth';
import { IS_PUBLIC } from './public.decorator';
import { JwtVerifierService } from './jwt-verifier.service';
import { setTenantPrincipal } from './request-principal';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: JwtVerifierService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The gateway authenticates at the handshake, not per event, so socket
    // contexts never reach this guard.
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('missing bearer token');

    let principal;
    try {
      principal = await this.verifier.verify(header.slice('Bearer '.length));
    } catch (err) {
      if (err instanceof AuthError) throw new UnauthorizedException(err.message);
      throw err;
    }

    setTenantPrincipal(req, principal);
    return true;
  }
}
```

`apps/agents/src/auth/request-principal.ts`:

```ts
import { TenantPrincipal } from '@marketplace/auth';

// Keyed by the Express request object (unique per request, garbage collected
// with it) rather than a mutated property, so this stays type-safe without
// augmenting Express's types.
const principals = new WeakMap<object, TenantPrincipal>();

export function setTenantPrincipal(req: object, principal: TenantPrincipal): void {
  principals.set(req, principal);
}

export function getTenantPrincipal(req: object): TenantPrincipal | undefined {
  return principals.get(req);
}
```

`apps/agents/src/auth/tenant-context.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { runWithTenant } from '@marketplace/auth';
import { getTenantPrincipal } from './request-principal';

/**
 * Binds the verified principal to the request's async scope. This must be an
 * interceptor rather than work the guard does directly — see the comment in
 * jwt-auth.guard.ts. next.handle() is called synchronously inside
 * runWithTenant's callback, which is what makes the binding stick.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request>();
    const principal = getTenantPrincipal(req);
    // Public route: the guard never verified a token, so there is nothing to bind.
    if (!principal) return next.handle();
    return runWithTenant(principal, () => next.handle());
  }
}
```

`apps/agents/src/auth/auth.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtVerifierService } from './jwt-verifier.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

@Global()
@Module({
  providers: [
    JwtVerifierService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Order matters: guards run before interceptors, so the principal is
    // always stashed by the time this binds the async scope.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
  exports: [JwtVerifierService],
})
export class AuthModule {}
```

Mark both health routes public: add `@Public()` above `live()` and `ready()` in `health.controller.ts`, importing it from `../auth/public.decorator`.

- [ ] **Step 4: Implement the gateway and the threads controller**

`apps/agents/src/chat/chat.gateway.ts`:

```ts
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { ZodType } from 'zod';
import { AuthError, runWithTenant, TenantPrincipal } from '@marketplace/auth';
import {
  AGENT_EVENTS,
  AgentStateSnapshot,
  ConfirmSchema,
  RejectSchema,
  SendMessageSchema,
  ThreadResumeSchema,
} from '@marketplace/contracts';
import { JwtVerifierService } from '../auth/jwt-verifier.service';
import { GraphService } from '../graph/graph.service';
import { ThreadRegistryService } from '../threads/thread-registry.service';
import { ProblemException } from '../common/problem';
import { toProblem } from '../common/problem.filter';

interface SocketData {
  principal: TenantPrincipal;
  token: string;
}

@WebSocketGateway({ namespace: '/agents', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit {
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly verifier: JwtVerifierService,
    private readonly threads: ThreadRegistryService,
    private readonly graph: GraphService,
  ) {}

  /**
   * Browsers cannot set headers on a WebSocket upgrade, so the token arrives in
   * the socket.io handshake. Verification is connection middleware rather than
   * a `handleConnection` hook: middleware rejects before the connection is
   * established, so an unauthenticated client gets `connect_error` instead of a
   * connection that succeeds and is then torn down.
   */
  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const token = (socket.handshake.auth as { token?: string } | undefined)?.token;
      try {
        if (!token) throw new AuthError('missing token');
        const principal = await this.verifier.verify(token);
        (socket.data as SocketData) = { principal, token };
        next();
      } catch (err) {
        this.logger.warn({ err }, 'rejected socket handshake');
        next(new Error('unauthorized'));
      }
    });
  }

  @SubscribeMessage(AGENT_EVENTS.threadStart)
  async onThreadStart(@ConnectedSocket() socket: Socket): Promise<void> {
    await this.handle(socket, async ({ principal }) => {
      const threadId = await this.threads.create(principal);
      return this.graph.snapshot(threadId);
    });
  }

  @SubscribeMessage(AGENT_EVENTS.threadResume)
  async onThreadResume(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId } = this.parse(ThreadResumeSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.snapshot(threadId);
    });
  }

  @SubscribeMessage(AGENT_EVENTS.message)
  async onMessage(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId, content } = this.parse(SendMessageSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token, threadId },
        action: 'message',
        content,
      });
    });
  }

  @SubscribeMessage(AGENT_EVENTS.confirm)
  async onConfirm(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId } = this.parse(ConfirmSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token, threadId },
        action: 'confirm',
      });
    });
  }

  @SubscribeMessage(AGENT_EVENTS.reject)
  async onReject(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    await this.handle(socket, async (data) => {
      const { threadId, notes } = this.parse(RejectSchema, body);
      await this.threads.touch(threadId, data.principal);
      return this.graph.run({
        threadId,
        ctx: { principal: data.principal, authToken: data.token, threadId },
        action: 'reject',
        // Notes become an ordinary user message, which is how the rejection
        // node distinguishes "change this" from "discard it".
        content: notes,
      });
    });
  }

  private parse<T>(schema: ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException(
        'invalid-event-payload',
        422,
        'Event payload is not valid',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return parsed.data;
  }

  private async handle(
    socket: Socket,
    fn: (data: SocketData) => Promise<AgentStateSnapshot>,
  ): Promise<void> {
    const data = socket.data as SocketData;
    const traceId = randomUUID();
    try {
      const snapshot = await runWithTenant(data.principal, () => fn(data));
      socket.emit(AGENT_EVENTS.state, snapshot);
    } catch (err) {
      const problem = toProblem(err);
      if (problem.status >= 500) {
        this.logger.error({ err, traceId, tenantId: data?.principal?.tenantId }, 'socket handler failed');
      }
      socket.emit(AGENT_EVENTS.error, { ...problem, traceId });
    }
  }
}
```

`apps/agents/src/chat/chat.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { ThreadsModule } from '../threads/threads.module';

@Module({ imports: [ThreadsModule], providers: [ChatGateway] })
export class ChatModule {}
```

`apps/agents/src/threads/threads.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { currentPrincipal } from '@marketplace/auth';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { GraphService } from '../graph/graph.service';
import { ThreadRegistryService } from './thread-registry.service';

@Controller('threads')
export class ThreadsController {
  constructor(
    private readonly threads: ThreadRegistryService,
    private readonly graph: GraphService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string): Promise<AgentStateSnapshot> {
    await this.threads.assertOwned(id, currentPrincipal());
    return this.graph.snapshot(id);
  }
}
```

`apps/agents/src/threads/threads.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { GraphModule } from '../graph/graph.module';
import { ThreadRegistryService } from './thread-registry.service';
import { ThreadsController } from './threads.controller';

@Module({
  imports: [GraphModule],
  controllers: [ThreadsController],
  providers: [ThreadRegistryService],
  exports: [ThreadRegistryService],
})
export class ThreadsModule {}
```

Register `AuthModule`, `ThreadsModule` and `ChatModule` in `app.module.ts`, after `GraphModule`.

- [ ] **Step 5: Run the e2e suite to verify it passes**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test:e2e`
Expected: PASS — three health cases and seven chat gateway cases.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add authenticated websocket gateway and thread reads"
```

---

### Task 12: End-to-end conversation suite and documentation

The acceptance gate. Everything before this proved a component; this proves the two services agree about the contract between them, against a real model.

Two rules make these tests survivable despite a non-deterministic model:

1. **Never assert on prose.** Only phase, field names, and what the Engine ended up holding.
2. **Drive the conversation in a loop.** A model may ask one clarifying question or three; the helper answers with a fixed reply until the phase advances or a turn budget is spent. A test that assumes a fixed number of turns is a flaky test.

**Files:**
- Create: `apps/agents/test/e2e/helpers/converse.ts`, `apps/agents/test/e2e/conversation.e2e.test.ts`
- Modify: `README.md`
- Modify: `scripts/e2e.mjs`

**Interfaces:**
- Consumes: everything.
- Produces: the five end-to-end invariants from the spec, and a documented way to run them.

- [ ] **Step 1: Write the failing e2e test**

`apps/agents/test/e2e/helpers/converse.ts`:

```ts
import { Socket } from 'socket.io-client';
import { AgentPhase, AgentStateSnapshot } from '@marketplace/contracts';
import { waitForState } from './socket';

export async function startThread(socket: Socket): Promise<string> {
  const pending = waitForState(socket, () => true, 15_000);
  socket.emit('thread.start', {});
  return (await pending).threadId;
}

export async function say(
  socket: Socket,
  threadId: string,
  content: string,
): Promise<AgentStateSnapshot> {
  const pending = waitForState(socket);
  socket.emit('message', { threadId, content });
  return pending;
}

/**
 * Drives the conversation until it reaches `target`, answering any clarifying
 * question with `followUp`. The turn budget exists because a local 7B model
 * may need more than one round to become specific — and because a test that
 * hangs is worse than one that fails.
 */
export async function driveTo(
  socket: Socket,
  threadId: string,
  opening: string,
  followUp: string,
  target: AgentPhase,
  maxTurns = 4,
): Promise<AgentStateSnapshot> {
  let snapshot = await say(socket, threadId, opening);
  for (let turn = 1; turn < maxTurns && snapshot.phase !== target; turn += 1) {
    snapshot = await say(socket, threadId, followUp);
  }
  if (snapshot.phase !== target) {
    throw new Error(
      `conversation reached ${snapshot.phase}, not ${target}, after ${maxTurns} turns; ` +
        `missing: ${snapshot.missingRequirements.join(', ')}`,
    );
  }
  return snapshot;
}
```

`apps/agents/test/e2e/conversation.e2e.test.ts`:

```ts
import { Socket } from 'socket.io-client';
import { engineBaseUrl, waitForAgentsHealthy } from './setup';
import { tokenFor } from './helpers/auth';
import { connectSocket, waitForError, waitForState } from './helpers/socket';
import { driveTo, startThread } from './helpers/converse';

const tenantId = `tenant_conv_${Math.random().toString(36).slice(2, 8)}`;
const username = `conv-${Date.now()}@example.com`;

const FIELD = 'dietaryNeeds';
const OPENING = `Add a text field called ${FIELD} to events so we can record what attendees can eat.`;
const FOLLOW_UP = `The field is named ${FIELD} and its type is text. It is optional.`;

jest.setTimeout(600_000);

async function engineHeaders(): Promise<HeadersInit> {
  return {
    authorization: `Bearer ${await tokenFor(tenantId, username)}`,
    'content-type': 'application/json',
  };
}

async function schemaVersion(): Promise<{ version: number; fields: Record<string, unknown> }> {
  const res = await fetch(`${engineBaseUrl}/api/v1/schemas/Event`, { headers: await engineHeaders() });
  return (await res.json()) as { version: number; fields: Record<string, unknown> };
}

async function waitForProposedFlow(field: string, timeoutMs = 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${engineBaseUrl}/api/v1/flows?limit=50`, { headers: await engineHeaders() });
    const { items } = (await res.json()) as {
      items: { id: string; status: string; blueprintDiff: { addedFields: { name: string }[] } }[];
    };
    const match = items.find((f) => f.blueprintDiff.addedFields.some((a) => a.name === field));
    if (match) return match.id;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

describe('agent conversation', () => {
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  async function open(tenant: string, user: string): Promise<Socket> {
    const socket = await connectSocket(await tokenFor(tenant, user));
    sockets.push(socket);
    return socket;
  }

  it('drafts a valid proposal, dispatches it on confirmation, and the engine proposes a flow', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);

    const drafted = await driveTo(socket, threadId, OPENING, FOLLOW_UP, 'awaiting_confirmation');

    // Structure, never prose.
    expect(drafted.targetEntity).toBe('Event');
    expect(drafted.draftPayload?.addedFields.map((f) => f.name)).toContain(FIELD);

    const before = await schemaVersion();

    const confirmed = waitForState(socket, (s) => s.phase === 'done');
    socket.emit('confirm', { threadId });
    const done = await confirmed;
    expect(done.dispatchedMessageId).not.toBeNull();

    // Asserted through the Engine rather than by reading the queue: the Engine's
    // consumer is running and would race a direct ReceiveMessage.
    const flowId = await waitForProposedFlow(FIELD);
    expect(flowId).not.toBeNull();

    // The proposal is not applied until a human executes it.
    expect((await schemaVersion()).version).toBe(before.version);

    const executed = await fetch(`${engineBaseUrl}/api/v1/flows/${flowId}/execute`, {
      method: 'POST',
      headers: await engineHeaders(),
    });
    expect(executed.status).toBe(200);

    const after = await schemaVersion();
    expect(after.version).toBe(before.version + 1);
    expect(after.fields[FIELD]).toBeDefined();
  });

  it('refuses to propose a field that already exists', async () => {
    // Runs after the first test, so FIELD is now in the registry.
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);

    const snapshot = await driveTo(
      socket,
      threadId,
      `Add a text field called ${FIELD} to events.`,
      `It is called ${FIELD} and it is text.`,
      'gathering',
    );

    expect(snapshot.draftPayload).toBeNull();
    expect(snapshot.phase).not.toBe('awaiting_confirmation');
  });

  it('resumes a conversation after a disconnect with its history intact', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);
    const first = await driveTo(socket, threadId, OPENING, FOLLOW_UP, 'awaiting_confirmation');
    const messageCount = first.messages.length;

    socket.disconnect();

    const reconnected = await open(tenantId, username);
    const resumed = waitForState(reconnected, () => true, 15_000);
    reconnected.emit('thread.resume', { threadId });
    const snapshot = await resumed;

    expect(snapshot.phase).toBe('awaiting_confirmation');
    expect(snapshot.messages).toHaveLength(messageCount);
    expect(snapshot.draftPayload).toEqual(first.draftPayload);
  });

  it('hides a thread from another tenant', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);

    const otherTenant = `tenant_conv_other_${Math.random().toString(36).slice(2, 8)}`;
    const intruder = await open(otherTenant, `intruder-${Date.now()}@example.com`);

    const pending = waitForError(intruder);
    intruder.emit('thread.resume', { threadId });
    expect((await pending).status).toBe(404);
  });

  it('discards a rejected proposal without dispatching', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);
    const field = `notes_${Math.random().toString(36).slice(2, 6)}`;

    await driveTo(
      socket,
      threadId,
      `Add a text field called ${field} to events.`,
      `It is called ${field} and it is text.`,
      'awaiting_confirmation',
    );

    const rejected = waitForState(socket, (s) => s.phase === 'done');
    socket.emit('reject', { threadId });
    const snapshot = await rejected;

    expect(snapshot.dispatchedMessageId).toBeNull();
    expect(snapshot.draftPayload).toBeNull();
    expect(await waitForProposedFlow(field, 10_000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm docker:up && pnpm --filter @marketplace/agents test:e2e`
Expected: FAIL — every conversation case fails, because until Tasks 1–11 are all in place nothing drives a full run. If Tasks 1–11 are complete, this suite should be run once and read carefully: a failure here is either a real defect or a prompt that the local model cannot follow, and those are distinguished by the error message `driveTo` produces.

- [ ] **Step 3: Extend the e2e runner**

Modify `scripts/e2e.mjs` so the run covers both services. Replace the single test invocation with, in order:

```js
  await run('pnpm', ['--filter', '@marketplace/engine', 'test:e2e']);
  await run('pnpm', ['--filter', '@marketplace/agents', 'test:e2e']);
```

keeping the existing up/down and exit-code handling around them. The Engine suite runs first because a failure there explains any failure in the Agents suite.

- [ ] **Step 4: Update the README**

Replace the README's opening paragraph and layout section, and add an Agents section. The file now describes two services:

```markdown
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

## Running

    pnpm install
    pnpm docker:up      # first run pulls a 4.7GB model; expect several minutes
    pnpm e2e            # engine suite, then agents suite

`pnpm docker:down` removes volumes, including the pulled model. To keep it
between runs use `docker compose -f docker/docker-compose.yml down`.

## The conversation

A client connects a WebSocket to `/agents` on port 3001, passing a Cognito ID
token in the socket.io handshake `auth.token`. Events are `thread.start`,
`thread.resume`, `message`, `confirm`, `reject`; the server replies with `state`
snapshots and `error` problem documents. Every payload shape is exported from
`@marketplace/contracts`.

Confirming a proposal does not change any schema. It queues a `PROPOSE_FLOW`
message; the Engine records a Flow at `status: 'proposed'`, and a human applies
it with `POST /api/v1/flows/:id/execute`.
```

- [ ] **Step 5: Run the whole thing**

Run: `pnpm docker:up && pnpm e2e`
Expected: PASS — every Engine e2e suite, then agents health, chat gateway, and the five conversation invariants.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add end-to-end agent conversation suite and document both services"
```

---

## Coverage against the spec

| Spec section | Where it is implemented |
|---|---|
| §2 prerequisite: `GET /schemas` | Task 2 |
| §2 prerequisite: shared `packages/auth` | Task 1 |
| §3 repository layout, Ollama in Compose, configuration | Task 4 |
| §4 state shape and `toSnapshot` | Task 8 |
| §4 `analyzeIntentNode`, `loadRegistryNode` | Task 8 |
| §4 `requirementCheckNode`, `draftSchemaNode`, `validationNode`, attempt bound | Task 9 |
| §4 confirmation as an explicit event; `dispatchNode`; derived deduplication id | Task 10 |
| §5 client protocol and event payloads | Tasks 3 and 11 |
| §6 handshake auth, tenant isolation, thread ownership | Tasks 7 and 11 |
| §7 problem types across both transports | Tasks 4, 6, 10, 11 |
| §8 deviations: bounded loop, typed draft, explicit confirm, registry grounding | Tasks 8–10 |
| §10 unit tests | Tasks 3, 5, 7–10 |
| §10 integration tests | Tasks 5–10 |
| §10 end-to-end invariants 1–5 | Task 12 |
