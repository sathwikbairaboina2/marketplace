# OpenAPI Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve an authenticated, self-authorizing Swagger UI from both `MarketplaceEngine` and `MarketplaceAgents`, generated from the running Nest router and the Zod schemas that already validate every request, for local development only.

**Architecture:** A new shared package, `packages/openapi`, converts Zod schemas to inline OpenAPI 3 schema objects, builds and post-processes the Swagger document (bearer auth, RFC 9457 error responses), and hosts a gated `DevTokenModule` that mints a real Cognito token for a fixed dev identity. Both apps' `ZodBody`/`ZodQuery` decorators and `Public()` decorators fold in the OpenAPI half so no controller changes anything; a new `app.factory.ts` in each app (kept separate from `main.ts`, which still ends with a real `void bootstrap()`) exports the `createApp()` seam that calls `setupOpenApi` only when `DOCS_ENABLED` is true, and `docker/docker-compose.yml` is the only place that flag is ever true.

**Tech Stack:** `@nestjs/swagger@^11.4.6` (new runtime dependency of `packages/openapi`, `apps/engine`, `apps/agents` — Nest-11-compatible major; its own peerDependencies require `@nestjs/common`/`@nestjs/core` `^11.0.1`, which this repo already satisfies), `zod-to-json-schema@^3.25.2` (new dependency of `packages/openapi` only), zod `^3.23.8` (already used everywhere), NestJS `^11.0.0`, TypeScript `^5.6.0`, jest `^29.7.0` / ts-jest `^29.2.5` (existing test stack), `@aws-sdk/client-cognito-identity-provider@^3.665.0` (already a devDependency of both apps, reached only via dynamic `import()`).

## Global Constraints

- Node `>=22`, pnpm `9.12.0` (`packageManager` in root `package.json`), workspace layout per `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `docker/seed`).
- NestJS `^11.0.0` on both apps; zod `^3.23.8` everywhere a schema is written; TypeScript `^5.6.0`, `tsconfig.base.json`'s compiler options (`strict: true`, `experimentalDecorators`, `emitDecoratorMetadata`) apply to every new package/file.
- `@nestjs/swagger` becomes a runtime `dependency` (not devDependency) of `apps/engine` and `apps/agents`, because `ZodBody`/`ZodQuery`/`Public()` evaluate its decorators at class-definition time whether or not docs are enabled.
- `DOCS_ENABLED` defaults to `false` in both apps' `EnvSchema`. Only `docker/docker-compose.yml` ever sets it to `'true'`.
- `DevTokenModule.registerIfEnabled(env)` must return a module with no controller and no providers unless **both** `env.DOCS_ENABLED === true` **and** `env.COGNITO_ENDPOINT` is set. There is no partial-enable state.
- `@aws-sdk/client-cognito-identity-provider` stays a devDependency of both apps. `DevTokenService` reaches it only through a dynamic `await import('@aws-sdk/client-cognito-identity-provider')` inside `mint()`, never a static top-level import anywhere in `packages/openapi` or either app, so a build that never enables docs never needs the package to resolve.
- Commit messages follow this repo's existing convention (see `git log`): `type(scope): imperative, lowercase summary`, e.g. `feat(openapi): ...`, `fix(agents): ...`, `test(engine): ...`, `chore(docker): ...`. No body is required but is allowed.
- No commit may add a Claude (or any AI) co-author trailer, under any circumstance.
- Windows/PowerShell and plain git-bash must both be able to run every command in this plan; no POSIX-only syntax (`&&` chaining inside a single Bash-tool call is fine, since the Bash tool here runs Git Bash).

---

## File Structure

| Path | Responsibility |
|---|---|
| `packages/openapi/package.json` | New workspace package manifest |
| `packages/openapi/tsconfig.json` | Extends `tsconfig.base.json`, matches `packages/auth`/`packages/contracts` |
| `packages/openapi/jest.config.js` | Unit-test config, matches `packages/contracts/jest.config.js` |
| `packages/openapi/src/index.ts` | Public exports of the package |
| `packages/openapi/src/zod-openapi.ts` | `toOpenApi(schema)` |
| `packages/openapi/src/zod-openapi.test.ts` | Unit tests for `toOpenApi` |
| `packages/openapi/src/problem.ts` | `ProblemSchema`, `PROBLEM_SCHEMA_NAME` |
| `packages/openapi/src/problem.test.ts` | Unit tests for the Problem schema |
| `packages/openapi/src/setup.ts` | `setupOpenApi(app, options)`, `customJsStr` |
| `packages/openapi/src/setup.test.ts` | Unit tests for `setupOpenApi`'s document post-processing |
| `packages/openapi/src/dev-token/dev-token.env.ts` | `DEV_TOKEN_ENV` token, `DevTokenEnv` interface |
| `packages/openapi/src/dev-token/dev-token.service.ts` | `DevTokenService.mint()` — mirrors `test/e2e/helpers/auth.ts` |
| `packages/openapi/src/dev-token/dev-token.controller.ts` | `POST /dev/token`, publicly marked |
| `packages/openapi/src/dev-token/dev-token.module.ts` | `DevTokenModule.registerIfEnabled(env)` |
| `packages/openapi/src/dev-token/dev-token.module.test.ts` | Unit tests for the gating logic |
| `apps/engine/src/common/zod-validation.pipe.ts` | `ZodBody`/`ZodQuery` gain `ApiBody`/`ApiQuery` |
| `apps/engine/src/common/zod-validation.pipe.test.ts` | Unit tests proving the OpenAPI metadata is attached |
| `apps/engine/src/auth/public.decorator.ts` | `Public()` gains `ApiOperation({ security: [] })` |
| `apps/engine/src/auth/public.decorator.test.ts` | Unit tests for the guard metadata + OpenAPI effect |
| `apps/agents/src/auth/public.decorator.ts` | Same change, agents side |
| `apps/agents/src/auth/public.decorator.test.ts` | Same test, agents side |
| `apps/engine/src/config/env.schema.ts` | Adds `DOCS_ENABLED`, `DEV_TENANT_ID`, `DEV_USERNAME`, `COGNITO_ENDPOINT`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID` |
| `apps/engine/src/config/env.schema.test.ts` | Unit tests for the new fields |
| `apps/agents/src/config/env.schema.ts` | Same six fields, agents side |
| `apps/agents/src/config/env.schema.test.ts` | Same tests, agents side |
| `apps/agents/src/threads/threads.controller.ts` | `@ApiOkResponse` on `GET /threads/:id` |
| `apps/agents/src/threads/threads.controller.test.ts` | Unit test for the response schema |
| `apps/engine/src/app.factory.ts` | New: exports `createApp()`; calls `setupOpenApi` when `DOCS_ENABLED` |
| `apps/engine/src/main.ts` | Shrinks to `createApp()` + `app.listen(...)` |
| `apps/engine/src/app.module.ts` | Imports `DevTokenModule.registerIfEnabled(...)` |
| `apps/agents/src/app.factory.ts` | New: same as engine's, agents side |
| `apps/agents/src/main.ts` | Same shrink, agents side |
| `apps/agents/src/app.module.ts` | Same change, agents side |
| `apps/engine/src/docs/openapi-document.int-test.ts` | Boots the real engine app, asserts document shape |
| `apps/engine/src/docs/dev-token-flag.int-test.ts` | Asserts docs/dev-token 404 when `DOCS_ENABLED` is unset |
| `apps/agents/src/docs/openapi-document.int-test.ts` | Same, agents side |
| `apps/agents/src/docs/dev-token-flag.int-test.ts` | Same, agents side |
| `apps/engine/package.json` | Adds `@marketplace/openapi`, `@nestjs/swagger` dependencies |
| `apps/agents/package.json` | Same two dependencies |
| `docker/docker-compose.yml` | `DOCS_ENABLED: 'true'` and `COGNITO_ENDPOINT` on `engine` and `agents` |
| `apps/agents/test/e2e/dev-token.e2e.test.ts` | Docker e2e: dev-token mint on both services, accepted downstream |
| `README.md` | Documents the docs URLs and the flag |

---

### Task 1: Scaffold `packages/openapi` and implement `toOpenApi`

**Files:**
- Create: `packages/openapi/package.json`
- Create: `packages/openapi/tsconfig.json`
- Create: `packages/openapi/jest.config.js`
- Create: `packages/openapi/src/index.ts`
- Create: `packages/openapi/src/zod-openapi.ts`
- Test: `packages/openapi/src/zod-openapi.test.ts`

**Interfaces:**
- Consumes: `CreateProductSchema`, `SearchProductsSchema` from `@marketplace/contracts` (`packages/contracts/src/product.ts`); `FieldDefinitionSchema` from `@marketplace/contracts` (`packages/contracts/src/registry.ts`).
- Produces: `toOpenApi(schema: ZodSchema): SchemaObject` (`SchemaObject` from `@nestjs/swagger`) — every later task in this plan that documents a request or response calls this exact function.

- [ ] **Step 1: Write the package scaffold and the failing test**

Create `packages/openapi/package.json`:

```json
{
  "name": "@marketplace/openapi",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "jest"
  },
  "dependencies": {
    "zod-to-json-schema": "^3.25.2"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/swagger": "^11.4.6",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@marketplace/contracts": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/swagger": "^11.4.6",
    "@nestjs/testing": "^11.0.0",
    "@types/jest": "^29.5.13",
    "@types/node": "^22.7.0",
    "jest": "^29.7.0",
    "reflect-metadata": "^0.2.2",
    "ts-jest": "^29.2.5",
    "typescript": "^5.6.0",
    "zod": "^3.23.8"
  }
}
```

Create `packages/openapi/tsconfig.json` (identical convention to `packages/auth/tsconfig.json` and `packages/contracts/tsconfig.json`):

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts"]
}
```

Create `packages/openapi/jest.config.js` (identical to `packages/contracts/jest.config.js` — this package has only unit tests, no `int-test`s):

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
};
```

Create `packages/openapi/src/index.ts`:

```ts
export * from './zod-openapi';
```

Create the failing test, `packages/openapi/src/zod-openapi.test.ts`:

```ts
import { CreateProductSchema, SearchProductsSchema, FieldDefinitionSchema } from '@marketplace/contracts';
import { toOpenApi } from './zod-openapi';

describe('toOpenApi', () => {
  describe('CreateProductSchema', () => {
    const result = toOpenApi(CreateProductSchema) as Record<string, any>;

    it('renders a strict object as a closed schema', () => {
      expect(result.type).toBe('object');
      expect(result.additionalProperties).toBe(false);
    });

    it('requires only the fields with no default', () => {
      expect(result.required).toEqual(
        expect.arrayContaining(['name', 'description', 'priceMinor', 'currency', 'category', 'stock']),
      );
      expect(result.required).not.toEqual(expect.arrayContaining(['images', 'status', 'attributes']));
    });

    it('renders the .url() array as a string array with a uri format', () => {
      expect(result.properties.images).toMatchObject({
        type: 'array',
        items: { type: 'string', format: 'uri' },
      });
    });

    it('renders the nested enum values', () => {
      expect(result.properties.status.enum).toEqual(['active', 'draft', 'archived', 'out_of_stock']);
    });
  });

  describe('SearchProductsSchema', () => {
    const result = toOpenApi(SearchProductsSchema) as Record<string, any>;

    it('renders the nullable cursor field', () => {
      expect(result.properties.cursor.nullable).toBe(true);
    });

    it('renders the record-of-union attributes field', () => {
      expect(result.properties.attributes.type).toBe('object');
      expect(result.properties.attributes.additionalProperties.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'string' }),
          expect.objectContaining({ type: 'number' }),
          expect.objectContaining({ type: 'boolean' }),
        ]),
      );
    });
  });

  describe('FieldDefinitionSchema', () => {
    const result = toOpenApi(FieldDefinitionSchema) as Record<string, any>;

    it('renders every declared field type as an enum value', () => {
      expect(result.properties.type.enum).toEqual([
        'string', 'number', 'boolean', 'date', 'string[]', 'number[]', 'boolean[]', 'date[]',
      ]);
    });

    it('carries the default for a defaulted boolean field', () => {
      expect(result.properties.required.default).toBe(false);
    });

    it('carries the nullable default value field', () => {
      expect(result.properties.default.nullable).toBe(true);
      expect(result.properties.default.default).toBe(null);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/openapi test`

Expected: FAIL — `Cannot find module './zod-openapi' from 'src/zod-openapi.test.ts'` (the module doesn't exist yet). If `pnpm install` has not been run since `package.json` was added, run `pnpm install` first from the repo root.

- [ ] **Step 3: Write the implementation**

Create `packages/openapi/src/zod-openapi.ts`:

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';
import type { SchemaObject } from '@nestjs/swagger';

/**
 * Converts a Zod schema into an inline OpenAPI 3 schema object. Schemas are
 * inlined ($refStrategy: 'none') rather than collected into a `components`
 * graph: for a browsable local docs page an inline schema reads better and
 * avoids an entire class of component-naming collisions.
 *
 * `.strict()` becomes `additionalProperties: false`; `.default()` values
 * survive into the schema (as `default`) and are excluded from `required`,
 * so Swagger UI's "Try it out" pre-fills a body that already passes
 * `ZodValidationPipe`.
 */
export function toOpenApi(schema: ZodSchema): SchemaObject {
  return zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' }) as SchemaObject;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/openapi test`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/openapi/package.json packages/openapi/tsconfig.json packages/openapi/jest.config.js packages/openapi/src/index.ts packages/openapi/src/zod-openapi.ts packages/openapi/src/zod-openapi.test.ts
git commit -m "feat(openapi): scaffold packages/openapi and convert zod schemas to inline OpenAPI 3"
```

---

### Task 2: Add the shared RFC 9457 Problem component schema

**Files:**
- Create: `packages/openapi/src/problem.ts`
- Modify: `packages/openapi/src/index.ts`
- Test: `packages/openapi/src/problem.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PROBLEM_SCHEMA_NAME: string` (value `'Problem'`), `ProblemSchema: SchemaObject`. Task 3 (`setupOpenApi`) imports both.

- [ ] **Step 1: Write the failing test**

Create `packages/openapi/src/problem.test.ts`:

```ts
import { PROBLEM_SCHEMA_NAME, ProblemSchema } from './problem';

describe('ProblemSchema', () => {
  it('is named Problem', () => {
    expect(PROBLEM_SCHEMA_NAME).toBe('Problem');
  });

  it('requires type, title and status', () => {
    expect(ProblemSchema.type).toBe('object');
    expect(ProblemSchema.required).toEqual(['type', 'title', 'status']);
  });

  it('declares detail as an optional string, not in required', () => {
    expect(ProblemSchema.properties?.detail).toEqual({ type: 'string' });
    expect(ProblemSchema.required).not.toContain('detail');
  });

  it('allows any other field, to cover the per-type extra fields ProblemException accepts', () => {
    expect(ProblemSchema.additionalProperties).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/openapi test -- problem.test.ts`

Expected: FAIL — `Cannot find module './problem' from 'src/problem.test.ts'`

- [ ] **Step 3: Write the implementation**

Create `packages/openapi/src/problem.ts`:

```ts
import type { SchemaObject } from '@nestjs/swagger';

export const PROBLEM_SCHEMA_NAME = 'Problem';

/**
 * The RFC 9457 problem body every `ProblemFilter` in both services writes to
 * the wire (see `apps/engine/src/common/problem.ts` / `problem.filter.ts`,
 * mirrored in agents). `additionalProperties: true` covers the per-type
 * `extra` fields `ProblemException` accepts (e.g. `errors[]` on a 400 from
 * `ZodValidationPipe`) and the `instance`/`traceId` fields `ProblemFilter`
 * adds after the exception is built.
 */
export const ProblemSchema: SchemaObject = {
  type: 'object',
  properties: {
    type: { type: 'string' },
    title: { type: 'string' },
    status: { type: 'number' },
    detail: { type: 'string' },
  },
  required: ['type', 'title', 'status'],
  additionalProperties: true,
};
```

Update `packages/openapi/src/index.ts`:

```ts
export * from './zod-openapi';
export * from './problem';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/openapi test -- problem.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/openapi/src/problem.ts packages/openapi/src/problem.test.ts packages/openapi/src/index.ts
git commit -m "feat(openapi): add the shared RFC 9457 Problem component schema"
```

---

### Task 3: Implement `setupOpenApi` and the dev-token pre-fill script

**Files:**
- Create: `packages/openapi/src/setup.ts`
- Modify: `packages/openapi/src/index.ts`
- Test: `packages/openapi/src/setup.test.ts`

**Interfaces:**
- Consumes: `PROBLEM_SCHEMA_NAME`, `ProblemSchema` from `./problem` (Task 2).
- Produces: `setupOpenApi(app: INestApplication, options: SetupOpenApiOptions): OpenAPIObject` where `SetupOpenApiOptions = { title: string; version: string }`. Tasks 9 and 10 (`app.factory.ts` in both apps) call this exact signature.

- [ ] **Step 1: Write the failing test**

Create `packages/openapi/src/setup.test.ts`:

```ts
import 'reflect-metadata';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { ApiOperation, OpenAPIObject } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { setupOpenApi } from './setup';
import { PROBLEM_SCHEMA_NAME } from './problem';

@Controller('widgets')
class WidgetsController {
  @Get()
  list(): string[] {
    return [];
  }
}

@Controller('health')
class HealthController {
  @ApiOperation({ security: [] })
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [WidgetsController, HealthController] })
class TestAppModule {}

describe('setupOpenApi', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = setupOpenApi(app, { title: 'Test', version: '1.0.0' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a bearer http security scheme named "bearer"', () => {
    expect(document.components?.securitySchemes?.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });

  it('sets a global security requirement', () => {
    expect(document.security).toEqual([{ bearer: [] }]);
  });

  it('registers the Problem schema as a reusable component', () => {
    expect(document.components?.schemas?.[PROBLEM_SCHEMA_NAME]).toBeDefined();
  });

  it('adds a default problem response to every operation', () => {
    const op = document.paths['/widgets'].get!;
    expect(op.responses.default).toMatchObject({
      content: {
        'application/problem+json': {
          schema: { $ref: `#/components/schemas/${PROBLEM_SCHEMA_NAME}` },
        },
      },
    });
  });

  it('adds a 401 problem response to an operation that kept the global security requirement', () => {
    const op = document.paths['/widgets'].get!;
    expect(op.responses['401']).toBeDefined();
  });

  it('does not add a 401 response to an operation with an empty security requirement', () => {
    const op = document.paths['/health/live'].get!;
    expect(op.responses['401']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/openapi test -- setup.test.ts`

Expected: FAIL — `Cannot find module './setup' from 'src/setup.test.ts'`

- [ ] **Step 3: Write the implementation**

Create `packages/openapi/src/setup.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PROBLEM_SCHEMA_NAME, ProblemSchema } from './problem';

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head'] as const;

const PROBLEM_JSON_RESPONSE = {
  description: 'A problem detail, per RFC 9457.',
  content: {
    'application/problem+json': {
      schema: { $ref: `#/components/schemas/${PROBLEM_SCHEMA_NAME}` },
    },
  },
};

// Waits for Swagger UI to attach `window.ui`, then mints a dev token from
// this same origin's gated `POST ../dev/token` and pre-authorizes it, so
// "Try it out" works without a manual copy-paste. Failure -- flag off,
// Cognito down, the dev-token package missing -- is non-fatal by
// construction: it logs to the console and leaves the Authorize button
// working normally. `../dev/token` is relative to the docs path
// (`api/v1/docs`), landing on `api/v1/dev/token` on the same origin, so no
// CORS configuration is involved.
const customJsStr = `
(function () {
  function waitForUi() {
    if (window.ui) {
      fetch('../dev/token', { method: 'POST' })
        .then(function (res) {
          if (!res.ok) throw new Error('dev token request failed: ' + res.status);
          return res.json();
        })
        .then(function (body) {
          window.ui.preauthorizeApiKey('bearer', body.token);
        })
        .catch(function (err) {
          console.log('OpenAPI dev-token pre-fill skipped:', err);
        });
      return;
    }
    setTimeout(waitForUi, 100);
  }
  waitForUi();
})();
`;

export interface SetupOpenApiOptions {
  title: string;
  version: string;
}

/**
 * Builds the OpenAPI document from the running Nest application, registers a
 * global bearer security requirement, injects a shared `default`/`401`
 * problem response on every operation, and serves Swagger UI at
 * `api/v1/docs` (the JSON document is served at `api/v1/docs-json` by
 * `@nestjs/swagger`'s own convention). Call only when `DOCS_ENABLED` is true,
 * after `setGlobalPrefix('api/v1')` and before `app.listen(...)`.
 */
export function setupOpenApi(app: INestApplication, options: SetupOpenApiOptions): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle(options.title)
    .setVersion(options.version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // An empty operation-level `security` array (set by `Public()`) overrides
  // this global requirement for that operation; @nestjs/swagger and the
  // OpenAPI 3 spec both treat operation-level `security` as a full override,
  // never a merge.
  document.security = [{ bearer: [] }];

  document.components = document.components ?? {};
  document.components.schemas = {
    ...(document.components.schemas ?? {}),
    [PROBLEM_SCHEMA_NAME]: ProblemSchema,
  };

  for (const pathItem of Object.values(document.paths ?? {})) {
    const operations = pathItem as Record<
      string,
      { security?: unknown[]; responses?: Record<string, unknown> } | undefined
    >;
    for (const method of HTTP_METHODS) {
      const operation = operations[method];
      if (!operation) continue;

      operation.responses = { ...operation.responses, default: PROBLEM_JSON_RESPONSE };

      const isPublic = Array.isArray(operation.security) && operation.security.length === 0;
      if (!isPublic) {
        operation.responses['401'] = PROBLEM_JSON_RESPONSE;
      }
    }
  }

  SwaggerModule.setup('api/v1/docs', app, document, {
    customJsStr,
    swaggerOptions: { persistAuthorization: true },
  });

  return document;
}
```

Update `packages/openapi/src/index.ts`:

```ts
export * from './zod-openapi';
export * from './problem';
export * from './setup';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/openapi test -- setup.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/openapi/src/setup.ts packages/openapi/src/setup.test.ts packages/openapi/src/index.ts
git commit -m "feat(openapi): build setupOpenApi and the dev-token pre-fill script"
```

---

### Task 4: Implement `DevTokenModule`

**Files:**
- Create: `packages/openapi/src/dev-token/dev-token.env.ts`
- Create: `packages/openapi/src/dev-token/dev-token.service.ts`
- Create: `packages/openapi/src/dev-token/dev-token.controller.ts`
- Create: `packages/openapi/src/dev-token/dev-token.module.ts`
- Modify: `packages/openapi/src/index.ts`
- Test: `packages/openapi/src/dev-token/dev-token.module.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks in this package (the controller marks itself public independently — see rationale in Step 3).
- Produces: `DevTokenEnv` interface (`{ DOCS_ENABLED: boolean; DEV_TENANT_ID: string; DEV_USERNAME: string; AWS_REGION: string; COGNITO_ENDPOINT?: string; COGNITO_USER_POOL_ID?: string; COGNITO_CLIENT_ID?: string }`), `DEV_TOKEN_ENV: symbol`, `DevTokenModule.registerIfEnabled(env: DevTokenEnv): DynamicModule`. Task 9 and 10 (`app.module.ts` in both apps) call `DevTokenModule.registerIfEnabled(EnvSchema.parse(process.env))`.

- [ ] **Step 1: Write the failing test**

Create `packages/openapi/src/dev-token/dev-token.env.ts` first (a plain interface + symbol, not itself under test, needed for the test file below to type-check):

```ts
export const DEV_TOKEN_ENV = Symbol('DEV_TOKEN_ENV');

export interface DevTokenEnv {
  DOCS_ENABLED: boolean;
  DEV_TENANT_ID: string;
  DEV_USERNAME: string;
  AWS_REGION: string;
  COGNITO_ENDPOINT?: string;
  COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;
}
```

Create `packages/openapi/src/dev-token/dev-token.module.test.ts`:

```ts
import 'reflect-metadata';
import { DevTokenModule } from './dev-token.module';
import { DevTokenController } from './dev-token.controller';

const BASE_ENV = {
  DEV_TENANT_ID: 'tenant-dev',
  DEV_USERNAME: 'dev@marketplace.local',
  AWS_REGION: 'us-east-1',
};

describe('DevTokenModule.registerIfEnabled', () => {
  it('contributes no controller when DOCS_ENABLED is false', () => {
    const mod = DevTokenModule.registerIfEnabled({
      ...BASE_ENV,
      DOCS_ENABLED: false,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
    });
    expect(mod.controllers ?? []).toHaveLength(0);
    expect(mod.providers ?? []).toHaveLength(0);
  });

  it('contributes no controller when COGNITO_ENDPOINT is unset', () => {
    const mod = DevTokenModule.registerIfEnabled({ ...BASE_ENV, DOCS_ENABLED: true });
    expect(mod.controllers ?? []).toHaveLength(0);
    expect(mod.providers ?? []).toHaveLength(0);
  });

  it('registers DevTokenController when both DOCS_ENABLED and COGNITO_ENDPOINT are set', () => {
    const mod = DevTokenModule.registerIfEnabled({
      ...BASE_ENV,
      DOCS_ENABLED: true,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
    });
    expect(mod.controllers).toEqual([DevTokenController]);
    expect(mod.providers).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/openapi test -- dev-token.module.test.ts`

Expected: FAIL — `Cannot find module './dev-token.module' from 'src/dev-token/dev-token.module.test.ts'`

- [ ] **Step 3: Write the implementation**

Create `packages/openapi/src/dev-token/dev-token.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DEV_TOKEN_ENV, DevTokenEnv } from './dev-token.env';

const PASSWORD = 'Passw0rd!';

/**
 * Mints a real Cognito ID token for a fixed dev identity. Mirrors
 * `apps/*/test/e2e/helpers/auth.ts`'s `tokenFor` exactly: AdminCreateUser
 * (tolerating UsernameExistsException) -> AdminUpdateUserAttributes forcing
 * `custom:tenant_id` -> AdminSetUserPassword -> InitiateAuth with
 * USER_PASSWORD_AUTH.
 *
 * `@aws-sdk/client-cognito-identity-provider` is a devDependency of both
 * apps, reached only through this dynamic import, evaluated at call time --
 * never at module-load time -- so a build that never invokes `mint()` never
 * needs the package to resolve.
 */
@Injectable()
export class DevTokenService {
  constructor(@Inject(DEV_TOKEN_ENV) private readonly env: DevTokenEnv) {}

  async mint(): Promise<string> {
    const {
      CognitoIdentityProviderClient,
      AdminCreateUserCommand,
      AdminUpdateUserAttributesCommand,
      AdminSetUserPasswordCommand,
      InitiateAuthCommand,
    } = await import('@aws-sdk/client-cognito-identity-provider');

    const userPoolId = this.env.COGNITO_USER_POOL_ID!;
    const clientId = this.env.COGNITO_CLIENT_ID!;
    const username = this.env.DEV_USERNAME;
    const tenantId = this.env.DEV_TENANT_ID;

    const client = new CognitoIdentityProviderClient({
      region: this.env.AWS_REGION,
      endpoint: this.env.COGNITO_ENDPOINT,
    });

    try {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: username,
          MessageAction: 'SUPPRESS',
          UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
        }),
      );
    } catch (err) {
      if ((err as Error).name !== 'UsernameExistsException') throw err;

      await client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: userPoolId,
          Username: username,
          UserAttributes: [{ Name: 'custom:tenant_id', Value: tenantId }],
        }),
      );
    }

    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
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
}
```

Create `packages/openapi/src/dev-token/dev-token.controller.ts`:

```ts
import { Controller, HttpCode, HttpStatus, Post, SetMetadata } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { DevTokenService } from './dev-token.service';

// Duplicated deliberately: both apps' `auth/public.decorator.ts` define
// `IS_PUBLIC = 'isPublic'` and their `JwtAuthGuard` reads it via
// `Reflector.getAllAndOverride(IS_PUBLIC, ...)`. This package cannot import
// either app's decorator -- apps depend on packages, never the reverse --
// so it sets the same metadata key directly. The guard matches on this
// string value, not on which module's constant produced it.
const IS_PUBLIC = 'isPublic';

@Controller('dev/token')
export class DevTokenController {
  constructor(private readonly devToken: DevTokenService) {}

  @SetMetadata(IS_PUBLIC, true)
  @ApiOperation({ security: [] })
  @HttpCode(HttpStatus.OK)
  @Post()
  async mint(): Promise<{ token: string }> {
    return { token: await this.devToken.mint() };
  }
}
```

Create `packages/openapi/src/dev-token/dev-token.module.ts`:

```ts
import { DynamicModule, Module } from '@nestjs/common';
import { DEV_TOKEN_ENV, DevTokenEnv } from './dev-token.env';
import { DevTokenController } from './dev-token.controller';
import { DevTokenService } from './dev-token.service';

@Module({})
export class DevTokenModule {
  /**
   * Returns a module with no controller and no providers unless both
   * `env.DOCS_ENABLED` is true and `env.COGNITO_ENDPOINT` is set. In a
   * deployed build the route does not exist -- it is not registered, so it
   * 404s from the router, rather than existing and refusing.
   */
  static registerIfEnabled(env: DevTokenEnv): DynamicModule {
    if (!env.DOCS_ENABLED || !env.COGNITO_ENDPOINT) {
      return { module: DevTokenModule };
    }

    return {
      module: DevTokenModule,
      controllers: [DevTokenController],
      providers: [{ provide: DEV_TOKEN_ENV, useValue: env }, DevTokenService],
    };
  }
}
```

Update `packages/openapi/src/index.ts`:

```ts
export * from './zod-openapi';
export * from './problem';
export * from './setup';
export * from './dev-token/dev-token.env';
export * from './dev-token/dev-token.module';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/openapi test -- dev-token.module.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add packages/openapi/src/dev-token packages/openapi/src/index.ts
git commit -m "feat(openapi): add DevTokenModule, gated on DOCS_ENABLED and COGNITO_ENDPOINT"
```

---

### Task 5: Document `ZodBody`/`ZodQuery` request shapes in the engine

**Files:**
- Modify: `apps/engine/package.json`
- Modify: `apps/engine/src/common/zod-validation.pipe.ts`
- Test: `apps/engine/src/common/zod-validation.pipe.test.ts`

**Interfaces:**
- Consumes: `toOpenApi` from `@marketplace/openapi` (Task 1).
- Produces: `ZodBody(schema: ZodSchema): ParameterDecorator`, `ZodQuery(schema: ZodSchema): ParameterDecorator` — signatures unchanged from today, so no controller (`products.controller.ts` etc.) needs to change. `ZodValidationPipe` is unchanged.

- [ ] **Step 1: Write the failing test**

First add the two new dependencies to `apps/engine/package.json` (`dependencies`, alphabetical with the existing block):

```json
    "@aws-sdk/client-dynamodb": "^3.665.0",
    "@aws-sdk/client-sqs": "^3.665.0",
    "@aws-sdk/lib-dynamodb": "^3.665.0",
    "@marketplace/auth": "workspace:*",
    "@marketplace/contracts": "workspace:*",
    "@marketplace/openapi": "workspace:*",
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/swagger": "^11.4.6",
```

(leave every other line in `dependencies` unchanged), then run `pnpm install` from the repo root so the workspace link and the new dependency are resolvable.

Create `apps/engine/src/common/zod-validation.pipe.test.ts`:

```ts
import 'reflect-metadata';
import { Controller, Get, INestApplication, Module, Post } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { ZodBody, ZodQuery } from './zod-validation.pipe';

const BodySchema = z.object({ name: z.string().min(1), nickname: z.string().optional() }).strict();
const QuerySchema = z.object({ limit: z.coerce.number().int().default(25), cursor: z.string().optional() });

@Controller('widgets')
class WidgetsController {
  @Post()
  create(@ZodBody(BodySchema) body: z.infer<typeof BodySchema>): { name: string } {
    return { name: body.name };
  }

  @Get()
  list(@ZodQuery(QuerySchema) query: z.infer<typeof QuerySchema>): { limit: number } {
    return { limit: query.limit };
  }
}

@Module({ controllers: [WidgetsController] })
class TestAppModule {}

describe('ZodBody / ZodQuery OpenAPI documentation', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the ZodBody schema as the request body, defaults absent from required', () => {
    const requestBody = document.paths['/widgets'].post!.requestBody as {
      content: { 'application/json': { schema: Record<string, any> } };
    };
    const schema = requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(['name']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('documents each ZodQuery top-level key as its own query parameter, with required-ness', () => {
    const params = document.paths['/widgets'].get!.parameters as Array<{ name: string; required?: boolean }>;
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(Object.keys(byName).sort()).toEqual(['cursor', 'limit']);
    expect(byName.limit.required).toBeFalsy();
    expect(byName.cursor.required).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/engine test -- zod-validation.pipe.test.ts`

Expected: FAIL — the `post` operation's `requestBody` is `undefined` (`Cannot read properties of undefined (reading 'content')`), because `ZodBody`/`ZodQuery` do not yet call `ApiBody`/`ApiQuery`.

- [ ] **Step 3: Write the implementation**

Replace the contents of `apps/engine/src/common/zod-validation.pipe.ts`:

```ts
import { ArgumentMetadata, Body, PipeTransform, Query } from '@nestjs/common';
import { ApiBody, ApiQuery } from '@nestjs/swagger';
import { toOpenApi } from '@marketplace/openapi';
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

// `Body(...)` is a parameter decorator, invoked as `(target, key, index)`.
// `ApiBody(...)` is a method decorator that reads `descriptor.value`.
// `applyDecorators` cannot compose them: it would hand `ApiBody` a parameter
// index where it expects a descriptor and throw at class-definition time.
// This decorator applies `ApiBody` itself, against the descriptor it looks
// up from the prototype -- methods are installed on the prototype before
// member decorators run, so it is present.
export const ZodBody = (schema: ZodSchema): ParameterDecorator => {
  const body = Body(new ZodValidationPipe(schema));
  return (target, key, index) => {
    body(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) ApiBody({ schema: toOpenApi(schema) })(target, key, descriptor);
  };
};

// Same shape as ZodBody, but emits one ApiQuery per top-level key of the
// converted schema, carrying that key's schema and whether it is required.
export const ZodQuery = (schema: ZodSchema): ParameterDecorator => {
  const query = Query(new ZodValidationPipe(schema));
  return (target, key, index) => {
    query(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return;

    const converted = toOpenApi(schema) as unknown as {
      properties?: Record<string, Record<string, unknown>>;
      required?: string[];
    };
    const required = new Set(converted.required ?? []);
    for (const [name, propertySchema] of Object.entries(converted.properties ?? {})) {
      ApiQuery({ name, required: required.has(name), schema: propertySchema })(target, key, descriptor);
    }
  };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- zod-validation.pipe.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/engine/package.json apps/engine/src/common/zod-validation.pipe.ts apps/engine/src/common/zod-validation.pipe.test.ts
git commit -m "feat(engine): document ZodBody/ZodQuery request shapes for Swagger"
```

---

### Task 6: Give `Public()` an OpenAPI-visible empty security requirement

**Files:**
- Modify: `apps/agents/package.json`
- Modify: `apps/engine/src/auth/public.decorator.ts`
- Modify: `apps/agents/src/auth/public.decorator.ts`
- Test: `apps/engine/src/auth/public.decorator.test.ts`
- Test: `apps/agents/src/auth/public.decorator.test.ts`

**Interfaces:**
- Consumes: `applyDecorators`, `SetMetadata` from `@nestjs/common`; `ApiOperation` from `@nestjs/swagger`.
- Produces: `IS_PUBLIC: string` (unchanged value `'isPublic'`), `Public(): MethodDecorator` (unchanged call signature — every existing `@Public()` call site in both apps' controllers needs no change).

- [ ] **Step 1: Write the failing test**

Add `@nestjs/swagger` to `apps/agents/package.json`'s `dependencies` (agents does not yet have it; engine already gained it in Task 5):

```json
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
    "@nestjs/swagger": "^11.4.6",
    "@nestjs/websockets": "^11.0.0",
```

(insert `@nestjs/swagger` alphabetically; leave every other line unchanged), then run `pnpm install` from the repo root.

Create `apps/engine/src/auth/public.decorator.test.ts`:

```ts
import 'reflect-metadata';
import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC, Public } from './public.decorator';

@Controller('widgets')
class WidgetsController {
  @Public()
  @Get('open')
  open(): string {
    return 'ok';
  }

  @Get('closed')
  closed(): string {
    return 'ok';
  }
}

@Module({ controllers: [WidgetsController] })
class TestAppModule {}

describe('Public()', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('still sets the isPublic reflector metadata the guard reads', () => {
    const reflector = new Reflector();
    const instance = app.get(WidgetsController);
    expect(reflector.get<boolean>(IS_PUBLIC, instance.open)).toBe(true);
    expect(reflector.get<boolean>(IS_PUBLIC, instance.closed)).toBeUndefined();
  });

  it('overrides the global security requirement with an empty array in the OpenAPI document', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    expect(document.paths['/widgets/open'].get!.security).toEqual([]);
    expect(document.paths['/widgets/closed'].get!.security).toBeUndefined();
  });
});
```

Create `apps/agents/src/auth/public.decorator.test.ts` with identical content (same relative import path `./public.decorator`, agents' `public.decorator.ts` is edited identically below).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/engine test -- public.decorator.test.ts` and `pnpm --filter @marketplace/agents test -- public.decorator.test.ts`

Expected: FAIL (both) — `document.paths['/widgets/open'].get.security` is `undefined`, not `[]` (`Public()` does not yet call `ApiOperation`).

- [ ] **Step 3: Write the implementation**

Replace `apps/engine/src/auth/public.decorator.ts`:

```ts
import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';

export const IS_PUBLIC = 'isPublic';

// MethodDecorator, not a generic decorator: applying @Public() at class level
// would expose every route in that controller with no way to opt a single
// route back out, since the guard reads getAllAndOverride(handler, class).
export const Public = (): MethodDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), ApiOperation({ security: [] }));
```

Replace `apps/agents/src/auth/public.decorator.ts` with the identical content above.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- public.decorator.test.ts` and `pnpm --filter @marketplace/agents test -- public.decorator.test.ts`

Expected: PASS (both)

- [ ] **Step 5: Commit**
```bash
git add apps/agents/package.json apps/engine/src/auth/public.decorator.ts apps/engine/src/auth/public.decorator.test.ts apps/agents/src/auth/public.decorator.ts apps/agents/src/auth/public.decorator.test.ts
git commit -m "feat: mark Public() routes with an empty OpenAPI security requirement"
```

---

### Task 7: Add `DOCS_ENABLED` and dev-token env vars to both services

**Files:**
- Modify: `apps/engine/src/config/env.schema.ts`
- Modify: `apps/agents/src/config/env.schema.ts`
- Test: `apps/engine/src/config/env.schema.test.ts`
- Test: `apps/agents/src/config/env.schema.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `EnvConfig` in both apps gains `DOCS_ENABLED: boolean`, `DEV_TENANT_ID: string`, `DEV_USERNAME: string`, `COGNITO_ENDPOINT?: string`, `COGNITO_USER_POOL_ID?: string`, `COGNITO_CLIENT_ID?: string`. This satisfies the `DevTokenEnv` interface from Task 4 structurally (same field names and types). Tasks 9 and 10 read `env.DOCS_ENABLED` and pass `env` to `DevTokenModule.registerIfEnabled`.

- [ ] **Step 1: Write the failing test**

Create `apps/engine/src/config/env.schema.test.ts`:

```ts
import { EnvSchema } from './env.schema';

const REQUIRED_ENV = {
  QUEUE_URL: 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo',
  REDIS_URL: 'redis://localhost:6379',
  JWKS_URI: 'http://localhost:9229/pool/.well-known/jwks.json',
  JWT_ISSUER: 'http://localhost:9229/pool',
  JWT_AUDIENCE: 'client-id',
};

describe('EnvSchema docs configuration', () => {
  it('defaults DOCS_ENABLED to false', () => {
    expect(EnvSchema.parse(REQUIRED_ENV).DOCS_ENABLED).toBe(false);
  });

  it('parses DOCS_ENABLED="true" to the boolean true', () => {
    expect(EnvSchema.parse({ ...REQUIRED_ENV, DOCS_ENABLED: 'true' }).DOCS_ENABLED).toBe(true);
  });

  it('defaults DEV_TENANT_ID and DEV_USERNAME', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.DEV_TENANT_ID).toBe('tenant-dev');
    expect(env.DEV_USERNAME).toBe('dev@marketplace.local');
  });

  it('leaves the Cognito admin variables optional', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.COGNITO_ENDPOINT).toBeUndefined();
    expect(env.COGNITO_USER_POOL_ID).toBeUndefined();
    expect(env.COGNITO_CLIENT_ID).toBeUndefined();
  });

  it('accepts explicit Cognito admin variables', () => {
    const env = EnvSchema.parse({
      ...REQUIRED_ENV,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
      COGNITO_USER_POOL_ID: 'pool-1',
      COGNITO_CLIENT_ID: 'client-1',
    });
    expect(env.COGNITO_ENDPOINT).toBe('http://cognito-local:9229');
    expect(env.COGNITO_USER_POOL_ID).toBe('pool-1');
    expect(env.COGNITO_CLIENT_ID).toBe('client-1');
  });
});
```

Create `apps/agents/src/config/env.schema.test.ts`:

```ts
import { EnvSchema } from './env.schema';

const REQUIRED_ENV = {
  QUEUE_URL: 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo',
  REDIS_URL: 'redis://localhost:6379',
  ENGINE_BASE_URL: 'http://localhost:3000',
  JWKS_URI: 'http://localhost:9229/pool/.well-known/jwks.json',
  JWT_ISSUER: 'http://localhost:9229/pool',
  JWT_AUDIENCE: 'client-id',
  OLLAMA_BASE_URL: 'http://localhost:11434',
};

describe('EnvSchema docs configuration', () => {
  it('defaults DOCS_ENABLED to false', () => {
    expect(EnvSchema.parse(REQUIRED_ENV).DOCS_ENABLED).toBe(false);
  });

  it('parses DOCS_ENABLED="true" to the boolean true', () => {
    expect(EnvSchema.parse({ ...REQUIRED_ENV, DOCS_ENABLED: 'true' }).DOCS_ENABLED).toBe(true);
  });

  it('defaults DEV_TENANT_ID and DEV_USERNAME', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.DEV_TENANT_ID).toBe('tenant-dev');
    expect(env.DEV_USERNAME).toBe('dev@marketplace.local');
  });

  it('leaves the Cognito admin variables optional', () => {
    const env = EnvSchema.parse(REQUIRED_ENV);
    expect(env.COGNITO_ENDPOINT).toBeUndefined();
    expect(env.COGNITO_USER_POOL_ID).toBeUndefined();
    expect(env.COGNITO_CLIENT_ID).toBeUndefined();
  });

  it('accepts explicit Cognito admin variables', () => {
    const env = EnvSchema.parse({
      ...REQUIRED_ENV,
      COGNITO_ENDPOINT: 'http://cognito-local:9229',
      COGNITO_USER_POOL_ID: 'pool-1',
      COGNITO_CLIENT_ID: 'client-1',
    });
    expect(env.COGNITO_ENDPOINT).toBe('http://cognito-local:9229');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/engine test -- env.schema.test.ts` and `pnpm --filter @marketplace/agents test -- env.schema.test.ts`

Expected: FAIL (both) — a TypeScript compile error, e.g. `Property 'DOCS_ENABLED' does not exist on type '{ PORT: number; ... }'` (the field is not yet declared on `EnvSchema`).

- [ ] **Step 3: Write the implementation**

In `apps/engine/src/config/env.schema.ts`, add six fields after `SQS_CONSUMER_ENABLED`:

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
  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEV_TENANT_ID: z.string().min(1).default('tenant-dev'),
  DEV_USERNAME: z.string().min(1).default('dev@marketplace.local'),
  COGNITO_ENDPOINT: z.string().url().optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');
```

In `apps/agents/src/config/env.schema.ts`, add the same six fields after `LOG_LEVEL`:

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
  DOCS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DEV_TENANT_ID: z.string().min(1).default('tenant-dev'),
  DEV_USERNAME: z.string().min(1).default('dev@marketplace.local'),
  COGNITO_ENDPOINT: z.string().url().optional(),
  COGNITO_USER_POOL_ID: z.string().min(1).optional(),
  COGNITO_CLIENT_ID: z.string().min(1).optional(),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
export const ENV = Symbol('ENV');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- env.schema.test.ts` and `pnpm --filter @marketplace/agents test -- env.schema.test.ts`

Expected: PASS (both)

- [ ] **Step 5: Commit**
```bash
git add apps/engine/src/config/env.schema.ts apps/engine/src/config/env.schema.test.ts apps/agents/src/config/env.schema.ts apps/agents/src/config/env.schema.test.ts
git commit -m "feat: add DOCS_ENABLED and dev-token env vars to both services"
```

---

### Task 8: Document agents' `threads/:id` response schema

**Files:**
- Modify: `apps/agents/package.json`
- Modify: `apps/agents/src/threads/threads.controller.ts`
- Test: `apps/agents/src/threads/threads.controller.test.ts`

**Interfaces:**
- Consumes: `toOpenApi` from `@marketplace/openapi` (Task 1); `AgentStateSnapshotSchema` from `@marketplace/contracts` (`packages/contracts/src/agent.ts`).
- Produces: no new exports — `ThreadsController.get` keeps its existing signature (`(id: string) => Promise<AgentStateSnapshot>`); only its OpenAPI metadata changes.

- [ ] **Step 1: Write the failing test**

Add `@marketplace/openapi` to `apps/agents/package.json`'s `dependencies` (alphabetical, agents already gained `@nestjs/swagger` in Task 6):

```json
    "@marketplace/auth": "workspace:*",
    "@marketplace/contracts": "workspace:*",
    "@marketplace/openapi": "workspace:*",
    "@nestjs/common": "^11.0.0",
```

then run `pnpm install` from the repo root.

Create `apps/agents/src/threads/threads.controller.test.ts`:

```ts
import 'reflect-metadata';
import { INestApplication, Module } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ThreadsController } from './threads.controller';
import { ThreadRegistryService } from './thread-registry.service';
import { GraphService } from '../graph/graph.service';

@Module({
  controllers: [ThreadsController],
  providers: [
    { provide: ThreadRegistryService, useValue: {} },
    { provide: GraphService, useValue: {} },
  ],
})
class TestAppModule {}

describe('ThreadsController OpenAPI documentation', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents the 200 response with the AgentStateSnapshot schema', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    const ok = document.paths['/threads/{id}'].get!.responses['200'] as {
      content: { 'application/json': { schema: Record<string, any> } };
    };
    const schema = ok.content['application/json'].schema;
    expect(schema.properties).toHaveProperty('threadId');
    expect(schema.properties).toHaveProperty('phase');
    expect(schema.properties).toHaveProperty('messages');
    expect(schema.properties).toHaveProperty('dispatchedMessageId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @marketplace/agents test -- threads.controller.test.ts`

Expected: FAIL — `Cannot read properties of undefined (reading 'content')` (`responses['200']` has no `content` yet; `@nestjs/swagger` infers only the bare return type today).

- [ ] **Step 3: Write the implementation**

Replace `apps/agents/src/threads/threads.controller.ts`:

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { toOpenApi } from '@marketplace/openapi';
import { currentPrincipal } from '@marketplace/auth';
import { AgentStateSnapshot, AgentStateSnapshotSchema } from '@marketplace/contracts';
import { GraphService } from '../graph/graph.service';
import { ThreadRegistryService } from './thread-registry.service';

@Controller('threads')
export class ThreadsController {
  constructor(
    private readonly threads: ThreadRegistryService,
    private readonly graph: GraphService,
  ) {}

  @ApiOkResponse({ schema: toOpenApi(AgentStateSnapshotSchema) })
  @Get(':id')
  async get(@Param('id') id: string): Promise<AgentStateSnapshot> {
    await this.threads.assertOwned(id, currentPrincipal());
    return this.graph.snapshot(id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/agents test -- threads.controller.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add apps/agents/package.json apps/agents/src/threads/threads.controller.ts apps/agents/src/threads/threads.controller.test.ts
git commit -m "feat(agents): document threads/:id's response schema"
```

---

### Task 9: Wire docs and dev-token into the engine's bootstrap

**Files:**
- Create: `apps/engine/src/app.factory.ts`
- Modify: `apps/engine/src/main.ts`
- Modify: `apps/engine/src/app.module.ts`
- Test: `apps/engine/src/docs/openapi-document.int-test.ts`
- Test: `apps/engine/src/docs/dev-token-flag.int-test.ts`

**Interfaces:**
- Consumes: `setupOpenApi` (Task 3), `DevTokenModule` (Task 4) from `@marketplace/openapi`; `EnvSchema`, `EnvConfig`, `ENV` (Task 7) from `./config/env.schema`; `REDIS` from `./redis/redis.module` (existing, unchanged).
- Produces: `createApp(): Promise<INestApplication>`, exported from a new `apps/engine/src/app.factory.ts` (not from `main.ts`) — the seam these two int-tests use to boot the real, fully-wired application without binding to a fixed port twice or invoking `bootstrap()`'s side effects. `main.ts` itself is not import-safe for tests: it ends with a top-level `void bootstrap()`, so merely importing it would start a real listener on `env.PORT`.

- [ ] **Step 1: Write the failing tests**

Create `apps/engine/src/docs/openapi-document.int-test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

const ENGINE_ROUTES = [
  '/api/v1/products',
  '/api/v1/products/{id}',
  '/api/v1/products/search',
  '/api/v1/events',
  '/api/v1/events/{id}',
  '/api/v1/orders',
  '/api/v1/orders/{id}',
  '/api/v1/bookings',
  '/api/v1/bookings/{id}',
  '/api/v1/flows',
  '/api/v1/flows/{id}/execute',
  '/api/v1/flows/{id}',
  '/api/v1/schemas',
  '/api/v1/schemas/{entityType}',
  '/api/v1/me',
  '/api/v1/health/live',
  '/api/v1/health/ready',
];

describe('OpenAPI document shape (engine)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let document: any;

  beforeAll(async () => {
    process.env.DOCS_ENABLED = 'true';
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

    const res = await fetch(`${baseUrl}/api/v1/docs-json`);
    document = await res.json();
  });

  afterAll(async () => {
    // RedisModule's provider is a bare `new Redis(env.REDIS_URL, ...)` with no
    // `lazyConnect` and no Nest `onModuleDestroy`, so `app.close()` alone
    // leaves the connection open -- Jest then warns about (or hangs on) an
    // open handle. Quit it explicitly before closing the app.
    await app.get<Redis>(REDIS).quit();
    await app.close();
  });

  it('has a path item for every registered route', () => {
    for (const route of ENGINE_ROUTES) {
      expect(document.paths).toHaveProperty(route);
    }
  });

  it('requires name in the POST /products request body', () => {
    const schema = document.paths['/api/v1/products'].post.requestBody.content['application/json'].schema;
    expect(schema.required).toContain('name');
  });

  it('lists limit and cursor as query parameters on GET /products', () => {
    const params = document.paths['/api/v1/products'].get.parameters as Array<{ name: string }>;
    expect(params.map((p) => p.name).sort()).toEqual(['cursor', 'limit']);
  });

  it('marks both health operations as not requiring the bearer token', () => {
    expect(document.paths['/api/v1/health/live'].get.security).toEqual([]);
    expect(document.paths['/api/v1/health/ready'].get.security).toEqual([]);
  });

  it('gives every operation a default problem response', () => {
    for (const pathItem of Object.values(document.paths) as Array<Record<string, any>>) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses).toHaveProperty('default');
      }
    }
  });
});
```

Create `apps/engine/src/docs/dev-token-flag.int-test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { DevTokenModule } from '@marketplace/openapi';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

describe('docs and dev-token are absent when DOCS_ENABLED is unset (engine)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DOCS_ENABLED;
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
    // See openapi-document.int-test.ts: RedisModule never closes its own
    // connection, so this test must.
    await app.get<Redis>(REDIS).quit();
    await app.close();
  });

  it('404s on the docs UI', async () => {
    const res = await fetch(`${baseUrl}/api/v1/docs`);
    expect(res.status).toBe(404);
  });

  it('404s on the dev-token endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('DevTokenModule contributes no controller when DOCS_ENABLED is unset', () => {
    const mod = DevTokenModule.registerIfEnabled({
      DOCS_ENABLED: false,
      DEV_TENANT_ID: 'tenant-dev',
      DEV_USERNAME: 'dev@marketplace.local',
      AWS_REGION: 'us-east-1',
    });
    expect(mod.controllers ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Both int-tests boot the real `AppModule`, which constructs a live `ioredis` connection via `RedisModule` — Redis must be reachable at `REDIS_URL` for either test to get past `beforeAll`, so run `pnpm docker:up` first (or otherwise have Redis listening on `localhost:6379`); without it, the failure below is a connection error, not the intended red state.

Run: `pnpm --filter @marketplace/engine test -- docs/openapi-document.int-test.ts`

Expected: FAIL — `Cannot find module '../app.factory' from 'src/docs/openapi-document.int-test.ts'` (the module doesn't exist yet); `apps/engine/src/docs/dev-token-flag.int-test.ts` fails the same way.

- [ ] **Step 3: Write the implementation**

Create `apps/engine/src/app.factory.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { setupOpenApi } from '@marketplace/openapi';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, EnvConfig } from './config/env.schema';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  // Without this, Nest never wires SIGTERM/SIGINT to the lifecycle it manages, so
  // `SqsConsumerService.onModuleDestroy` -- which stops the poll loop and closes the SQS
  // client -- would only ever run when a test calls `app.close()` directly, never on a real
  // `docker stop`/`docker compose down`. Node's own default SIGTERM handling would still kill
  // the process (so nothing hangs), just without giving the consumer a chance to finish its
  // current receive/handle cycle first.
  app.enableShutdownHooks();
  const env = app.get<EnvConfig>(ENV);
  if (env.DOCS_ENABLED) {
    setupOpenApi(app, { title: 'MarketplaceEngine', version: '1.0.0' });
  }
  return app;
}
```

Replace `apps/engine/src/main.ts` (shrinks to the `listen` step only, so importing it for its side effect is the only thing it ever does — nothing in this plan imports it):

```ts
import 'reflect-metadata';
import { createApp } from './app.factory';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const env = app.get<EnvConfig>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
```

Replace `apps/engine/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DevTokenModule } from '@marketplace/openapi';
import { ConfigModule } from './config/config.module';
import { EnvSchema } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { PersistenceModule } from './persistence/persistence.module';
import { RedisModule } from './redis/redis.module';
import { RegistryModule } from './registry/registry.module';
import { ProductsModule } from './products/products.module';
import { EventsModule } from './events/events.module';
import { OrdersModule } from './orders/orders.module';
import { BookingsModule } from './bookings/bookings.module';
import { FlowsModule } from './flows/flows.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { MessagingModule } from './messaging/messaging.module';

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
    DevTokenModule.registerIfEnabled(EnvSchema.parse(process.env)),
    AuthModule,
    HealthModule,
    PersistenceModule,
    RedisModule,
    RegistryModule,
    ProductsModule,
    EventsModule,
    OrdersModule,
    BookingsModule,
    FlowsModule,
    IdempotencyModule,
    MessagingModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/engine test -- docs/openapi-document.int-test.ts` and `pnpm --filter @marketplace/engine test -- docs/dev-token-flag.int-test.ts`

Expected: PASS (both). These tests assume the local infra started by `pnpm docker:up` (in particular Redis) is reachable at `localhost:6379`, matching every other `*.int-test.ts` in this repo; nothing here calls DynamoDB, SQS or Cognito, since none of the app's providers connect eagerly at construction.

- [ ] **Step 5: Commit**
```bash
git add apps/engine/src/app.factory.ts apps/engine/src/main.ts apps/engine/src/app.module.ts apps/engine/src/docs/openapi-document.int-test.ts apps/engine/src/docs/dev-token-flag.int-test.ts
git commit -m "feat(engine): serve Swagger UI and the dev-token endpoint when DOCS_ENABLED"
```

---

### Task 10: Wire docs and dev-token into agents' bootstrap

**Files:**
- Create: `apps/agents/src/app.factory.ts`
- Modify: `apps/agents/src/main.ts`
- Modify: `apps/agents/src/app.module.ts`
- Test: `apps/agents/src/docs/openapi-document.int-test.ts`
- Test: `apps/agents/src/docs/dev-token-flag.int-test.ts`

**Interfaces:**
- Consumes: `setupOpenApi`, `DevTokenModule` from `@marketplace/openapi`; `EnvSchema`, `EnvConfig`, `ENV` from `./config/env.schema` (Task 7); `REDIS` from `./redis/redis.module` (existing, unchanged).
- Produces: `createApp(): Promise<INestApplication>`, exported from a new `apps/agents/src/app.factory.ts` (not from `main.ts`) — same seam as Task 9, agents side, for the same reason: agents' `main.ts` also ends with a top-level `void bootstrap()`, so importing it directly would bind a real listener on `env.PORT` (3001) and leak it.

- [ ] **Step 1: Write the failing tests**

Create `apps/agents/src/docs/openapi-document.int-test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

const AGENTS_ROUTES = ['/api/v1/health/live', '/api/v1/health/ready', '/api/v1/threads/{id}'];

describe('OpenAPI document shape (agents)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let document: any;

  beforeAll(async () => {
    process.env.DOCS_ENABLED = 'true';
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.ENGINE_BASE_URL ??= 'http://localhost:3000';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';
    process.env.OLLAMA_BASE_URL ??= 'http://localhost:11434';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const res = await fetch(`${baseUrl}/api/v1/docs-json`);
    document = await res.json();
  });

  afterAll(async () => {
    // RedisModule's provider is a bare `new Redis(env.REDIS_URL, ...)` with no
    // `lazyConnect` and no Nest `onModuleDestroy`, so `app.close()` alone
    // leaves the connection open -- Jest then warns about (or hangs on) an
    // open handle. Quit it explicitly before closing the app.
    await app.get<Redis>(REDIS).quit();
    await app.close();
  });

  it('has a path item for every registered route', () => {
    for (const route of AGENTS_ROUTES) {
      expect(document.paths).toHaveProperty(route);
    }
  });

  it('marks both health operations as not requiring the bearer token', () => {
    expect(document.paths['/api/v1/health/live'].get.security).toEqual([]);
    expect(document.paths['/api/v1/health/ready'].get.security).toEqual([]);
  });

  it('documents the 200 response of threads/:id with the AgentStateSnapshot schema', () => {
    const schema =
      document.paths['/api/v1/threads/{id}'].get.responses['200'].content['application/json'].schema;
    expect(schema.properties).toHaveProperty('threadId');
    expect(schema.properties).toHaveProperty('phase');
  });

  it('gives every operation a default problem response', () => {
    for (const pathItem of Object.values(document.paths) as Array<Record<string, any>>) {
      for (const operation of Object.values(pathItem)) {
        expect(operation.responses).toHaveProperty('default');
      }
    }
  });
});
```

Create `apps/agents/src/docs/dev-token-flag.int-test.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type Redis from 'ioredis';
import { DevTokenModule } from '@marketplace/openapi';
import { createApp } from '../app.factory';
import { REDIS } from '../redis/redis.module';

describe('docs and dev-token are absent when DOCS_ENABLED is unset (agents)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DOCS_ENABLED;
    process.env.QUEUE_URL ??= 'http://sqs.us-east-1.localhost.localstack.cloud:4566/000000000000/q.fifo';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.ENGINE_BASE_URL ??= 'http://localhost:3000';
    process.env.JWKS_URI ??= 'http://localhost:9229/pool/.well-known/jwks.json';
    process.env.JWT_ISSUER ??= 'http://localhost:9229/pool';
    process.env.JWT_AUDIENCE ??= 'client-id';
    process.env.OLLAMA_BASE_URL ??= 'http://localhost:11434';

    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // See openapi-document.int-test.ts: RedisModule never closes its own
    // connection, so this test must.
    await app.get<Redis>(REDIS).quit();
    await app.close();
  });

  it('404s on the docs UI', async () => {
    const res = await fetch(`${baseUrl}/api/v1/docs`);
    expect(res.status).toBe(404);
  });

  it('404s on the dev-token endpoint', async () => {
    const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('DevTokenModule contributes no controller when DOCS_ENABLED is unset', () => {
    const mod = DevTokenModule.registerIfEnabled({
      DOCS_ENABLED: false,
      DEV_TENANT_ID: 'tenant-dev',
      DEV_USERNAME: 'dev@marketplace.local',
      AWS_REGION: 'us-east-1',
    });
    expect(mod.controllers ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Both int-tests boot the real `AppModule`, which constructs a live `ioredis` connection via `RedisModule` — Redis must be reachable at `REDIS_URL` for either test to get past `beforeAll`, so run `pnpm docker:up` first (or otherwise have Redis listening on `localhost:6379`); without it, the failure below is a connection error, not the intended red state.

Run: `pnpm --filter @marketplace/agents test -- docs/openapi-document.int-test.ts`

Expected: FAIL — `Cannot find module '../app.factory' from 'src/docs/openapi-document.int-test.ts'` (the module doesn't exist yet); `docs/dev-token-flag.int-test.ts` fails the same way.

- [ ] **Step 3: Write the implementation**

Create `apps/agents/src/app.factory.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { setupOpenApi } from '@marketplace/openapi';
import { AppModule } from './app.module';
import { ProblemFilter } from './common/problem.filter';
import { ENV, EnvConfig } from './config/env.schema';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  const env = app.get<EnvConfig>(ENV);
  if (env.DOCS_ENABLED) {
    setupOpenApi(app, { title: 'MarketplaceAgents', version: '1.0.0' });
  }
  return app;
}
```

Replace `apps/agents/src/main.ts` (shrinks to the `listen` step only):

```ts
import 'reflect-metadata';
import { createApp } from './app.factory';
import { ENV, EnvConfig } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const env = app.get<EnvConfig>(ENV);
  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
```

Replace `apps/agents/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DevTokenModule } from '@marketplace/openapi';
import { ConfigModule } from './config/config.module';
import { EnvSchema } from './config/env.schema';
import { RedisModule } from './redis/redis.module';
import { LlmModule } from './llm/llm.module';
import { HealthModule } from './health/health.module';
import { EngineClientModule } from './engine-client/engine-client.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { GraphModule } from './graph/graph.module';
import { AuthModule } from './auth/auth.module';
import { ThreadsModule } from './threads/threads.module';
import { ChatModule } from './chat/chat.module';

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
    DevTokenModule.registerIfEnabled(EnvSchema.parse(process.env)),
    RedisModule,
    LlmModule,
    EngineClientModule,
    DispatchModule,
    GraphModule,
    HealthModule,
    AuthModule,
    ThreadsModule,
    ChatModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @marketplace/agents test -- docs/openapi-document.int-test.ts` and `pnpm --filter @marketplace/agents test -- docs/dev-token-flag.int-test.ts`

Expected: PASS (both). As in Task 9, these rely only on Redis being reachable at `localhost:6379`; nothing here calls Ollama, the engine, or Cognito.

- [ ] **Step 5: Commit**
```bash
git add apps/agents/src/app.factory.ts apps/agents/src/main.ts apps/agents/src/app.module.ts apps/agents/src/docs/openapi-document.int-test.ts apps/agents/src/docs/dev-token-flag.int-test.ts
git commit -m "feat(agents): serve Swagger UI and the dev-token endpoint when DOCS_ENABLED"
```

---

### Task 11: Enable docs in Docker Compose and verify the dev-token pre-fill end to end

**Files:**
- Modify: `docker/docker-compose.yml`
- Modify: `README.md`
- Test: `apps/agents/test/e2e/dev-token.e2e.test.ts`

**Interfaces:**
- Consumes: `agentsBaseUrl`, `engineBaseUrl`, `waitForAgentsHealthy` from `apps/agents/test/e2e/setup.ts` (existing, unchanged); the real `POST /api/v1/dev/token`, `GET /api/v1/me` and `GET /api/v1/threads/:id` endpoints from Tasks 4, 9 and 10, running inside Docker.
- Produces: nothing new — this is the final proof that every earlier task's pieces work together against the real Docker stack.

This is the one task in this plan whose "make it pass" step is a Docker Compose change plus a README note, not application code: the test can only turn green once `docker/docker-compose.yml` actually sets `DOCS_ENABLED` and `COGNITO_ENDPOINT` on both services, since `docker:up` rebuilds the images (`--build`) from every source change made in Tasks 1–10.

- [ ] **Step 1: Write the failing test**

Create `apps/agents/test/e2e/dev-token.e2e.test.ts`:

```ts
import { ulid } from 'ulid';
import { agentsBaseUrl, engineBaseUrl, waitForAgentsHealthy } from './setup';

async function mintDevToken(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/dev/token`, { method: 'POST' });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

describe('dev-token pre-fill (docker)', () => {
  beforeAll(async () => {
    await waitForAgentsHealthy();
  }, 300_000);

  it('mints a token from the engine that GET /me accepts', async () => {
    const token = await mintDevToken(engineBaseUrl);
    const res = await fetch(`${engineBaseUrl}/api/v1/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it('mints a token from agents that GET /threads/:id accepts', async () => {
    const token = await mintDevToken(agentsBaseUrl);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${ulid()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    // A random id belongs to no thread, so the expected outcome is a 404
    // "no such thread" -- not a 401. A 404 here is proof the token was
    // accepted; a 401 would mean the dev-token pre-fill path is broken.
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm e2e`

Expected: FAIL — the `mintDevToken` calls receive `404` (not `200`), because `docker/docker-compose.yml` does not yet set `DOCS_ENABLED` or `COGNITO_ENDPOINT` on the `engine`/`agents` services, so `DevTokenModule.registerIfEnabled` never registers `DevTokenController` inside either running container.

- [ ] **Step 3: Write the implementation**

In `docker/docker-compose.yml`, add two lines to the `engine` service's `environment:` block (after `LOG_LEVEL: info`):

```yaml
      LOG_LEVEL: info
      DOCS_ENABLED: 'true'
      COGNITO_ENDPOINT: http://cognito-local:9229
```

And the same two lines to the `agents` service's `environment:` block (after its own `LOG_LEVEL: info`):

```yaml
      LOG_LEVEL: info
      DOCS_ENABLED: 'true'
      COGNITO_ENDPOINT: http://cognito-local:9229
```

`COGNITO_ENDPOINT` here is the container-internal address (matching the `seed` service's own `COGNITO_ENDPOINT: http://cognito-local:9229`), not the host-facing `COGNITO_ENDPOINT_HOST` that `docker/.env.generated` already supplies for the e2e suite running on the host — `DevTokenService` runs inside the container and must reach `cognito-local` over the compose network. `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` need no new wiring: `docker/.env.generated` already writes them under those exact names and both services already load that file via `env_file`.

In `README.md`, add a paragraph after the `pnpm docker:up` / `pnpm test` / `pnpm e2e` code block (after the `Subsequent runs reuse the ollama-models Docker volume...` paragraph, before `## The conversation`):

```markdown
With the stack up, Swagger UI is at `http://localhost:3000/api/v1/docs` (engine)
and `http://localhost:3001/api/v1/docs` (agents). Each page authorizes itself on
load: it calls its own `POST /api/v1/dev/token`, a dev-only endpoint that mints a
Cognito ID token for a fixed identity (`DEV_TENANT_ID`/`DEV_USERNAME`) and hands
it to Swagger UI's "Try it out". Neither the docs page nor `/dev/token` exists
unless `DOCS_ENABLED=true` **and** `COGNITO_ENDPOINT` is set — true only in
`docker/docker-compose.yml`, never in a deployed build.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm e2e`

Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add docker/docker-compose.yml README.md apps/agents/test/e2e/dev-token.e2e.test.ts
git commit -m "test: verify the dev-token prefill authenticates against both services"
```
