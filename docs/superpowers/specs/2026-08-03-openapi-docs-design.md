# OpenAPI docs for MarketplaceEngine and MarketplaceAgents

**Date:** 2026-08-03
**Status:** approved, not yet implemented

## Purpose

Serve Swagger UI from both services so the HTTP surface can be explored and
exercised by hand during local development, instead of by hand-written `curl`.
The page authorizes itself: on load it mints a Cognito ID token for a fixed dev
tenant and hands it to Swagger UI, so every "Try it out" call is authenticated
without a manual copy-paste step.

The audience is local development only. The spec is not published, is not
checked into the repository as an artifact, and is not fed to a client
generator. Those uses would raise the bar on response-body fidelity; see
[Out of scope](#out-of-scope).

## Current state

- 22 HTTP routes on the engine (`products`, `events`, `orders`, `bookings`,
  `flows`, `schemas`, `me`, `health`), 3 on agents (`health/live`,
  `health/ready`, `threads/:id`).
- Every request body and query shape is already a Zod schema, in
  `packages/contracts` or `apps/engine/src/common/list-query.schema.ts`, applied
  through the `ZodBody` / `ZodQuery` parameter decorators in
  `apps/engine/src/common/zod-validation.pipe.ts` — 11 call sites: five create
  bodies, five list queries sharing `ListQuerySchema`, and
  `POST /products/search`. The remaining routes take only a path parameter or
  nothing.
- Response shapes are hand-written TypeScript interfaces
  (`ProductResponse = Omit<ProductRecord, 'PK' | 'SK'>`, `SchemaView`), with no
  runtime schema to derive from. The one exception is agents' `threads/:id`,
  which returns `AgentStateSnapshot` and does have a Zod schema.
- No OpenAPI or Swagger dependency exists anywhere in the workspace.
- Authentication is a Cognito ID token as `Authorization: Bearer`, enforced by
  `JwtAuthGuard`, with `@Public()` (`SetMetadata(IS_PUBLIC, true)`) marking the
  routes that skip it.

## Approach

Generate the document from the Nest router and the Zod schemas that already
exist. `@nestjs/swagger` discovers routes, methods and path parameters from the
running application, so no hand-maintained route table can drift from the
controllers. Request schemas are converted from Zod at decorator-evaluation
time, so no schema is written twice.

Two approaches were rejected. Class DTOs with `@nestjs/swagger` decorators would
duplicate every Zod schema as a class and guarantee drift. A hand-written
`openapi.yaml` would cover 25 routes by hand and be stale immediately.

A third option — modelling response bodies as Zod in `packages/contracts` and
deriving the TypeScript types via `z.infer` — is deferred, not rejected. It is
the right move if these docs ever feed a client generator, but it is a refactor
of persistence-facing types across both services, which is not warranted by a
local-development docs page.

## Components

### `packages/openapi` (new workspace package)

A new private package alongside `packages/auth` and `packages/contracts`. Both
services need identical bootstrap, security wiring and token minting, so this is
shared rather than duplicated.

| File | Responsibility |
|---|---|
| `zod-openapi.ts` | `toOpenApi(schema)` — converts a Zod schema to an OpenAPI 3.0 schema object |
| `problem.ts` | The RFC 9457 problem body as one reusable component schema |
| `setup.ts` | `setupOpenApi(app, options)` — builds the document, injects shared responses, serves the UI |
| `dev-token/` | `DevTokenModule`, `DevTokenController`, `DevTokenService` — the gated token endpoint |

Peer dependencies: `@nestjs/common`, `@nestjs/core`, `@nestjs/swagger`, `zod`.
Direct dependency: `zod-to-json-schema`.

#### `toOpenApi`

Wraps `zod-to-json-schema` with `target: 'openApi3'` and `$refStrategy: 'none'`.
Schemas are inlined rather than collected into a `components` graph — for a
browsable page, an inline schema reads better and removes an entire class of
naming and collision problems.

`.strict()` becomes `additionalProperties: false`, and `.default()` values
survive into the schema, so Swagger UI's "Try it out" pre-fills a request body
that actually passes `ZodValidationPipe`.

#### `setupOpenApi`

Called from each service's `main.ts`, after `setGlobalPrefix('api/v1')` and
before `listen`, and only when `DOCS_ENABLED` is true. It:

1. Builds a `DocumentBuilder` with the service title, version, and
   `addBearerAuth()` registered as the security scheme named `bearer`.
2. Adds a global security requirement, so every operation demands a token by
   default.
3. Creates the document via `SwaggerModule.createDocument`.
4. Post-processes the document (see [Error responses](#error-responses)).
5. Serves it with `SwaggerModule.setup(docsPath, app, document, { customJsStr, swaggerOptions })`.

`docsPath` is `api/v1/docs`; the JSON is served at `api/v1/docs-json` by
`@nestjs/swagger`'s own convention.

### Request documentation, by decorator folding

`ZodBody` and `ZodQuery` in `apps/engine/src/common/zod-validation.pipe.ts` gain
an OpenAPI half. `applyDecorators` cannot express this: `Body(...)` is a
parameter decorator, invoked as `(target, key, index)`, while `ApiBody(...)` is a
method decorator that reads `descriptor.value`. Composing them would hand
`ApiBody` a parameter index where it expects a descriptor and throw at class
definition time. The parameter decorator therefore applies the method decorator
itself, against the descriptor it looks up from the prototype — methods are
installed on the prototype before member decorators run, so it is present:

```ts
export const ZodBody = (schema: ZodSchema): ParameterDecorator => {
  const body = Body(new ZodValidationPipe(schema));
  return (target, key, index) => {
    body(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (descriptor) ApiBody({ schema: toOpenApi(schema) })(target, key, descriptor);
  };
};
```

`ZodQuery` uses the same shape, emitting one `ApiQuery` per top-level key of the
converted schema, carrying that key's schema and whether it is required.

No controller file changes. All 11 body/query call sites document their request
shape from code already written, and any future endpoint that uses `ZodBody` is
documented the day it is added.

**Consequence:** `@nestjs/swagger` becomes a runtime `dependency` of both apps
rather than a devDependency, because these decorators are evaluated at
class-definition time whether or not docs are enabled. The alternative —
branching every decorator on the flag — is worse for a package this ordinary.

### Public routes

`Public()` in each app's `auth/public.decorator.ts` becomes a composed
decorator:

```ts
export const Public = (): MethodDecorator =>
  applyDecorators(SetMetadata(IS_PUBLIC, true), ApiOperation({ security: [] }));
```

An empty operation-level `security` array overrides the global requirement. The
guard and the document therefore read the same decorator, and cannot disagree
about which routes are open.

The comment already on `Public()` — that it is deliberately a `MethodDecorator`,
not a general one — still holds and stays.

### Response documentation

Success bodies are documented only where a Zod schema already exists: agents'
`threads/:id` gains `@ApiOkResponse({ schema: toOpenApi(AgentStateSnapshotSchema) })`.
Everywhere else the operation declares no success schema, and Swagger UI shows
the real response when the call is made. This is the deferred half of the
Zod-first approach.

### Error responses

`DocumentBuilder` has no hook for "every operation may return this", so
`setupOpenApi` walks the generated document's `paths` and, for each operation:

- adds a `default` response referencing the shared `Problem` component schema —
  `type`, `title`, `status`, optional `detail`, and `additionalProperties: true`
  to cover the `errors[]` array that `ZodValidationPipe` attaches on a 400 and
  the other per-type fields `ProblemException` accepts as `extra`;
- adds a `401` response, also `Problem`, on any operation that kept the global
  security requirement.

Content type on both is `application/problem+json`, matching `ProblemFilter`.

### `DevTokenModule`

This endpoint issues real credentials. The gating is the design, not an
implementation detail.

- `DevTokenModule.registerIfEnabled(env)` returns a module with no controller
  and no providers unless **both** `DOCS_ENABLED === true` **and**
  `COGNITO_ENDPOINT` is set. `DOCS_ENABLED` defaults to `false`, and only
  `docker/docker-compose.yml` sets it true. In a deployed build the route does
  not exist — it is not registered, so it 404s from the router, rather than
  existing and refusing.
- Route: `POST /api/v1/dev/token`, marked `@Public()`, taking no body.
- The identity is fixed from environment (`DEV_TENANT_ID`, default
  `tenant-dev`; `DEV_USERNAME`, default `dev@marketplace.local`). No caller
  input selects the tenant, so the endpoint cannot be pointed at an arbitrary
  tenant even if it were somehow reachable.
- Minting mirrors `apps/*/test/e2e/helpers/auth.ts`: `AdminCreateUser`
  (tolerating `UsernameExistsException`) → `AdminUpdateUserAttributes` forcing
  `custom:tenant_id` → `AdminSetUserPassword` → `InitiateAuth` with
  `USER_PASSWORD_AUTH`. Returns `{ token }` — the `IdToken`, which is what
  `JwtVerifier` accepts.
- `@aws-sdk/client-cognito-identity-provider` is presently a devDependency of
  both apps and stays one. The service reaches it through a dynamic
  `await import(...)` inside the enabled path, so a production build never
  resolves it. If the flag were ever true in a build lacking the package, the
  call fails loudly instead of pulling a dev dependency into the runtime graph.

### Token pre-fill

`SwaggerModule.setup` receives `customJsStr`: an IIFE that waits for
`window.ui`, `POST`s to `../dev/token` relative to the docs path, and calls
`ui.preauthorizeApiKey('bearer', token)`. `swaggerOptions.persistAuthorization`
is `true`, so a reload reuses the stored token and only re-mints when it is
absent.

Failure is non-fatal by construction: if the fetch fails — flag off, Cognito
down, package missing — the script logs to the console and leaves the Authorize
button working normally. The page degrades to "paste a token", never to a broken
page.

Each service serves its own UI (engine `:3000/api/v1/docs`, agents
`:3001/api/v1/docs`), each calling its own `dev/token` on the same origin, so no
CORS configuration is involved.

## Configuration

Both services' `config/env.schema.ts` gain:

| Variable | Type | Default |
|---|---|---|
| `DOCS_ENABLED` | `z.enum(['true','false']).transform(v => v === 'true')` | `'false'` |
| `DEV_TENANT_ID` | `z.string().min(1)` | `tenant-dev` |
| `DEV_USERNAME` | `z.string().min(1)` | `dev@marketplace.local` |
| `COGNITO_ENDPOINT` | `z.string().url().optional()` | — |
| `COGNITO_USER_POOL_ID` | `z.string().min(1).optional()` | — |
| `COGNITO_CLIENT_ID` | `z.string().min(1).optional()` | — |

The `DOCS_ENABLED` idiom matches the existing `SQS_CONSUMER_ENABLED`. The three
Cognito variables are already delivered to both containers through
`docker/.env.generated`; the schemas simply do not declare them yet.

`docker/docker-compose.yml` sets `DOCS_ENABLED: 'true'` on the `engine` and
`agents` services.

## Testing

Following the existing layout — `*.test.ts` unit, `*.int-test.ts` integration,
`test/e2e/` against the Docker stack.

**Unit, `packages/openapi`.** `toOpenApi` over representative contract schemas:
`CreateProductSchema` (strict object, defaults, `.url()` array, nested enum),
`SearchProductsSchema` (nullable, record of a union), `FieldDefinitionSchema`.
Assert `additionalProperties: false`, that defaulted fields are absent from
`required` while non-defaulted ones are present, and that enum values come
through.

**Integration, each app — document shape.** Boot with `DOCS_ENABLED=true`, fetch
`/api/v1/docs-json`, and assert against the Nest router: every registered route
has a path item; `POST /products` carries a `requestBody` whose schema requires
`name`; `GET /products` lists `limit` and `cursor` query parameters; health
operations carry `security: []`; every operation carries the `default` problem
response. This is the drift guard — a controller added without `ZodBody` shows
up here as an undocumented body.

**Integration, each app — flag off.** With `DOCS_ENABLED` unset, `/api/v1/docs`
and `/api/v1/dev/token` both 404, and `DevTokenModule` contributes no
controller.

**E2E, Docker.** `POST /api/v1/dev/token` against both running services returns
a token, and that token is accepted by `GET /api/v1/me` on the engine and
`GET /api/v1/threads/:id` on agents. This exercises the pre-fill path end to
end, which is the feature's whole point.

## Out of scope

- Response body schemas for engine entities. Deferred with the Zod-first
  refactor described under [Approach](#approach).
- The WebSocket protocol on `/agents`. OpenAPI cannot describe it.
- Any published, checked-in, or CI-verified spec artifact. The integration test
  is the drift guard; there is no generated file to review.
- Client generation from the document.
