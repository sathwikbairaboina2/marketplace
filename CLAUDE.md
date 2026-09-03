# Marketplace

A multi-tenant marketplace: a NestJS engine over a DynamoDB single table, a
LangGraph agents service, and a Next.js app that is both the storefront and the
seller's cockpit. Everything runs locally in Docker Compose.

This project stands on its own. Everything needed to boot it, test it and reason
about it is in this repository — no shared tooling, no scripts kept elsewhere, no
assumptions about anything else on the machine.

## Booting and testing

From the repository root:

```bash
pnpm docker:up      # infra -> seed -> engine/agents/web, gated on healthchecks
pnpm docker:down    # stop and drop volumes
pnpm test           # every package (see the concurrency note below)
pnpm e2e            # the whole-system script in scripts/e2e.mjs
```

Per package:

```bash
pnpm --filter @marketplace/contracts test
pnpm --filter @marketplace/engine test        # unit + int-tests (int-tests need the stack)
pnpm --filter @marketplace/engine test:e2e    # 19 suites against a running stack
pnpm --filter @marketplace/web test           # vitest
pnpm --filter @marketplace/web e2e:journeys   # 97 whole-system browser journeys
pnpm --filter @marketplace/web ui:campaign    # 161-case ordered browser session
```

**Type checking.** Every package has a `typecheck` script (`tsc --noEmit`);
`npx turbo run typecheck --concurrency=1` runs them all and is what CI runs.
It covers test files too, which `next build` does not. `next build` still
lints, so a UI change is finished only when the web build passes as well.

**Rebuilding one container after a source change**, rather than a full boot:

```bash
docker compose -f docker/docker-compose.yml up -d --build --force-recreate engine
```

`web` and `agents` take the same form. A full `pnpm docker:up` rebuilds and
re-seeds everything, which a change to one service cannot have invalidated.

## Ports this project publishes

| Port | Service |
|---|---|
| 33000 | engine |
| 33001 | agents |
| 33002 | web |
| 34566 | localstack |
| 36379 | redis |
| 38000 | dynamodb-local |
| 39229 | cognito-local |

Every host port is the service's default **plus 30000**. Inside the compose
network the defaults still apply (`engine:3000`, `redis:6379`, ...); only what
the host sees moved, because other projects on this machine sit on the
defaults. Host-side harnesses, the browser bundle's `NEXT_PUBLIC_*` values, the
seed's media URLs and the engine's `CORS_ORIGINS` all name the 3xxxx ports.

**There is no ollama in this stack.** `agents` uses one shared daemon,
`http://host.docker.internal:25103` (`research-ollama` from the research-plugin
project, GPU attached), which holds `qwen3.8:27b` for several projects at
once. `ollama-init` only checks that the model is there. `OLLAMA_BASE_URL` and
`LLM_MODEL` in the compose environment point it elsewhere; host-side tests
default to `127.0.0.1:25103`.

## Traps this machine will spring

- **`localhost` resolves to `::1` first, and Docker Desktop's IPv6 loopback proxy
  stops answering for minutes at a time**, typically just after a container is
  recreated. curl falls back to IPv4; **Chromium does not** — measured at 90ms to
  load the console on `127.0.0.1` against a 15s timeout on `localhost`, same
  second, same container. Host-side test harnesses use the IPv4 literal. Browser
  base URLs stay on `localhost`, because the page's origin must match what the
  engine allows, and the engine allows both spellings.

- **Parallel test runs lie.** A whole-repo `pnpm test` has twice produced a dozen
  unrelated red suites, every one passing alone. `int-test` suites boot Nest
  applications and one calls a local model that holds a core for a minute. Jest
  is capped at two workers per app, and the repo-wide run should be
  `npx turbo run test --concurrency=1`. **Re-run a red suite on its own before
  believing it.**

- **Never use `window.confirm`, `alert` or `prompt` in web code.** A native modal
  blocks the browser harness and takes the whole campaign with it. antd
  `Popconfirm` is what this codebase uses.

## Rules this codebase holds itself to

- **No floats for money.** Everything is minor units, integers, with bounds in
  `packages/contracts/src/common.ts` chosen so the worst-case order total cannot
  leave exact-integer range.
- **Every error is an RFC 9457 problem document.** `ProblemType` in
  `apps/engine/src/common/problem.ts` is a closed union — a new code must be
  declared there before it can be thrown.
- **Ownership failures answer 404, never 403.** A 403 confirms the record exists
  to somebody not allowed to see it.
- **Admin-only routes carry both** a `@Roles('admin')` decorator and a service
  check. The decorator makes the restriction visible in the OpenAPI document; the
  service check is what the unit tests pin and what protects a non-HTTP caller.
- **Nothing may be inserted into the order transaction ahead of the line-item
  updates.** `explainFailure` maps a cancelled transaction index back to a product
  *by position*.
- **Race tests assert on outcomes, not on error classes.** DynamoDB Local raises
  `ConditionalCheckFailed` where a real table raises `TransactionConflict`.
- **Verify UI by rendering it and looking.** Passing tests prove behaviour, not
  appearance; two real defects in the order-stages work were only ever going to be
  found in a screenshot.

## Where things are

| | |
|---|---|
| Shared contracts | `packages/contracts/src` — zod schemas both services and the browser validate against |
| Engine | `apps/engine/src` — one module per feature, DynamoDB single table in `persistence/` |
| Agents | `apps/agents/src` — LangGraph, Redis checkpointer |
| Web | `apps/web/app` — `(shop)` storefront, `(admin)` cockpit |
| Status | `docs/STATUS.md`, `docs/STATUS-order-stages.md` |
| Designs and plans | `docs/superpowers/specs`, `docs/superpowers/plans` |

## Current state

`master` is pushed to a private GitHub remote (`origin`) and is its default
branch. CI at `.github/workflows/ci.yml` runs unit, int and engine e2e on a
runner; the agents and web suites need the shared model and stay local.
