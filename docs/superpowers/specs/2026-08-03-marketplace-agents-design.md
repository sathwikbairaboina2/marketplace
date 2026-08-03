# MarketplaceAgents — Design Spec

**Date:** 2026-08-03
**Status:** Approved for planning
**Scope:** MarketplaceAgents only. MarketplaceEngine has its own spec; AWS deployment is a separate spec.

## 1. Context

`prd.pdf` splits the platform into two NestJS services decoupled by an SQS FIFO queue. The Engine — the deterministic core — is specified in `2026-08-03-marketplace-engine-design.md` and planned in `plans/2026-08-03-marketplace-engine.md`. This spec covers the second unit: **MarketplaceAgents**, the LangGraph.js orchestration layer that turns a multi-turn conversation into a validated schema-change proposal.

The Engine spec already fixed the contract between them. `packages/contracts/src/sqs.ts` types the message as:

```ts
export const EngineJobMessageSchema = z.object({
  action: z.literal('PROPOSE_FLOW'),
  targetEntity: DynamicEntityTypeSchema,
  tenantId: z.string().min(1),
  payload: BlueprintDiffSchema,
  metadata: z.object({ threadId: z.string() }).passthrough(),
});
```

`action` is a literal, and `BlueprintDiffSchema` accepts add-field diffs only. The Agents service therefore has exactly one write-side output, and this spec does not widen it.

### Goal and constraints

- Target is a **production service**, not a prototype.
- **Everything must run and be verified end to end in local Docker Compose before any real AWS deployment.** Same acceptance bar as the Engine.
- Consequence for this service: the LLM is a dependency like any other, and must have a working local substitute selected **by configuration only** — no code branches on environment.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Local LLM | Ollama container running `qwen2.5:7b-instruct` | Docker-first bar applies to the LLM too; strongest small model at schema-constrained JSON, which is what all three LLM nodes need |
| LLM abstraction | `LlmProvider` port | Unit tests need a scripted double; a hosted provider later becomes a config change |
| Persistence | None of its own | All state is conversation state; entity truth stays in the Engine |
| Conversation state | `@langchain/langgraph-checkpoint-redis` | Official saver; PRD specifies a Redis checkpointer |
| Client transport | WebSocket (socket.io) | Chosen for a live conversational UI |
| Agent capability | Schema evolution, plus read-only Engine queries for grounding | Matches the locked `PROPOSE_FLOW` literal; reads let the agent see existing fields before proposing |
| Registry access | Via a new Engine `GET /schemas` route | Keeps DynamoDB access exclusively inside the Engine |
| Auth code | Extracted to a shared `packages/auth` | Two services verifying JWTs independently is duplicated security-critical code |
| Confirmation | Explicit socket event, not LLM intent parsing | A misread "no, not that one" would dispatch an unwanted schema change |
| Redraft loop | Bounded at 3 attempts | The PRD's silent loop is unbounded; against a 7B model that is a hang |
| Testing | TDD: unit + integration + e2e, structural assertions only | Model output is non-deterministic; only structure is assertable |

### Prerequisites in the Engine plan

Neither service is built yet, so both changes are amendments to the Engine plan rather than migrations. They are carried as tasks in the Agents implementation plan and must land before the Agents modules that depend on them.

1. **Engine Task 9 gains registry reads.** `GET /api/v1/schemas` returns every registered entity schema for the tenant; `GET /api/v1/schemas/:entityType` returns one as `{ version, fields }`, or 404 when the tenant has never registered that entity. Both are tenant-scoped through the existing `DynamoRepository`, so isolation is unchanged.
2. **Engine Task 5's auth primitives move to `packages/auth`.** The `jose` JWKS verifier and the `TenantContext` `AsyncLocalStorage` store become a shared package consumed by both services. The Engine's `JwtAuthGuard` and this service's gateway handshake verifier are then two thin adapters over one verified implementation, rather than ~80 lines of security-critical code copy-pasted and free to drift.

## 3. Repository layout

```
marketplace/
├─ apps/
│  ├─ engine/                  NestJS — engine spec
│  └─ agents/                  NestJS — this spec
│     └─ src/
│        ├─ config/            zod-validated env
│        ├─ chat/              socket.io gateway, thread registry
│        ├─ graph/             state, nodes, edges, checkpointer wiring
│        ├─ llm/               LlmProvider port + Ollama and scripted impls
│        ├─ engine-client/     typed read-only HTTP client
│        ├─ dispatch/          SQS FIFO producer
│        └─ health/            liveness and readiness
├─ packages/
│  ├─ contracts/               Zod schemas — extended with agent shapes
│  └─ auth/                    JWKS verifier + TenantContext (new, shared)
└─ docker/
   └─ docker-compose.yml       extended with ollama, ollama-init, agents
```

Agent-facing shapes (`AgentPhase`, `AgentStateSnapshot`, socket event payloads) are authored in `packages/contracts/src/agent.ts` alongside the entity schemas, so a UI client and the service cannot disagree about them.

### Local stack additions

| Service | Image | Port | Purpose |
|---|---|---|---|
| ollama | `ollama/ollama:0.32.5` | 11434 | Serves the LLM nodes |
| ollama-init | `ollama/ollama:0.32.5` | — | One-shot `ollama pull qwen2.5:7b-instruct`, then exits 0 |
| agents | `./apps/agents` | 3001 | This service |

`redis`, `localstack`, `cognito-local` and `engine` are reused from the Engine's compose file. The model lives in a named volume, so the ~4.7GB pull happens on first stack creation rather than per run. `agents` depends on `ollama-init` completing successfully, so no request can reach a model that has not been pulled.

Ollama's healthcheck polls `GET /api/tags`; readiness for the `agents` service additionally requires that the configured `LLM_MODEL` appears in that list.

### Configuration

| Variable | Meaning |
|---|---|
| `OLLAMA_BASE_URL` | Ollama endpoint |
| `LLM_MODEL` | `qwen2.5:7b-instruct` locally |
| `LLM_TEMPERATURE` | `0` |
| `LLM_TIMEOUT_MS` | Per-call ceiling; exceeded produces `llm-unavailable` |
| `ENGINE_BASE_URL` | Engine origin for read-only queries |
| `ENGINE_TIMEOUT_MS` | Per-call ceiling; exceeded produces `engine-unavailable` |
| `REDIS_URL` | Checkpointer and thread registry |
| `SQS_ENDPOINT` | Optional. Unset means the SDK resolves real AWS |
| `QUEUE_URL` | `marketplace-engine-jobs.fifo` |
| `JWKS_URI`, `JWT_ISSUER`, `JWT_AUDIENCE` | Token verification |
| `DRAFT_MAX_ATTEMPTS` | Redraft bound, default `3` |
| `THREAD_TTL_SECONDS` | Conversation retention |

As in the Engine, `SQS_ENDPOINT` being optional is the whole environment-portability mechanism. A production deployment omits it, points `JWKS_URI` at the real Cognito pool, and points `OLLAMA_BASE_URL` at a hosted provider adapter. No code changes.

## 4. State machine

### State

The PRD's `AgentState` with four fields added and one retyped:

```ts
export type AgentPhase = 'gathering' | 'drafting' | 'validating' | 'awaiting_confirmation' | 'done';

export interface AgentState {
  tenantId: string;
  userId: string;
  messages: BaseMessage[];
  phase: AgentPhase;
  targetEntity: DynamicEntityType | null;
  draftPayload: BlueprintDiff | null;
  missingRequirements: string[];
  registrySnapshot: EntitySchemaRecord | null;
  validationErrors: string[];
  draftAttempts: number;
  dispatchedMessageId: string | null;
}
```

`draftPayload` is typed as `BlueprintDiff` rather than the PRD's `any`, because the Engine accepts nothing else — an untyped draft would only defer the failure to the dispatch boundary. `registrySnapshot` carries the grounding read. `validationErrors` is what makes the redraft loop informative rather than a blind retry. `draftAttempts` bounds it. `dispatchedMessageId` records what was sent, so a resumed thread can prove it already dispatched.

### Nodes

The PRD's five nodes, plus one deterministic loader for grounding.

1. **`analyzeIntentNode`** (LLM, structured output `{ targetEntity, action }`) — parses the conversation for the target entity. A null entity sets phase `gathering` and halts with a clarifying question.
2. **`loadRegistryNode`** (deterministic, added) — calls `GET /schemas/:entityType` through the engine-client, forwarding the caller's JWT, and populates `registrySnapshot`. An entity the tenant has never extended is not an error: the Engine answers 200 with `{ version: 0, fields: {} }`, which truthfully means "no dynamic fields yet". The Engine reserves 404 for an entity type that is not one of the four dynamic entities.
3. **`requirementCheckNode`** (LLM) — evaluates the conversation against the registry snapshot. Missing specs set `missingRequirements`, phase `gathering`, and halt for user input.
4. **`draftSchemaNode`** (LLM, structured output constrained to the `BlueprintDiff` JSON schema) — constructs the diff. On a redraft, `validationErrors` are included in the prompt.
5. **`validationNode`** (deterministic) — `BlueprintDiffSchema.parse`, plus the semantic checks a schema alone cannot make:
   - a field name already present in `registrySnapshot.fields` is rejected as a duplicate;
   - a field name colliding with a core field of the target entity is rejected;
   - anything that is not an add is rejected, matching the Engine's add-only rule.

   Failure returns to `draftSchemaNode` with `validationErrors` set and `draftAttempts` incremented. On exhausting `DRAFT_MAX_ATTEMPTS`, the graph drops to `gathering` with an explanatory message rather than looping further. Success sets phase `awaiting_confirmation` and halts.
6. **`dispatchNode`** (deterministic) — sends the message to the FIFO queue and sets phase `done`.

**A halt is a run that ends, not a suspended one.** Every client event is one `invoke` that runs from the entry point until it either finishes the work or reaches a point where it needs the user, at which point it routes to `END`. State survives between runs because the checkpointer holds it, and the next event starts a fresh run that a conditional entry edge routes according to the stored phase.

This is preferred over LangGraph `interrupt()` for one reason: with no run ever in flight between events, a dropped socket cannot strand a suspended execution. Reconnection then needs no recovery path at all — it is just another run against the same thread id.

### Confirmation

`awaiting_confirmation` resumes only on an explicit `confirm` or `reject` socket event. Free-text assent is not interpreted. A `reject` carrying revision notes returns the graph to `gathering` with those notes appended to `messages`; a bare `reject` ends the thread at `done` without dispatching.

This produces two deliberate gates before a tenant's registry changes: the user confirms in conversation, the Engine records a Flow at `status: 'proposed'`, and a human then calls `POST /flows/:id/execute`. The agent never applies a schema change on its own authority, which is what the Engine spec's consumer design already assumed.

### Dispatch

```
MessageGroupId        = tenantId
MessageDeduplicationId = sha256(threadId + canonicalJson(payload))
MessageBody           = EngineJobMessage
```

`MessageGroupId` is the tenant, per the PRD, which serializes concurrent schema updates for that tenant at the Engine. The deduplication id is derived rather than random so that a retried dispatch — after a socket drop, or a resumed checkpoint — cannot double-propose within the FIFO five-minute dedup window. `metadata.threadId` carries the conversation id, giving the Engine's Flow record a back-reference to the conversation that produced it.

The message is validated against `EngineJobMessageSchema` immediately before sending. The service never puts an unparseable body on the queue, regardless of what the model produced.

## 5. Client protocol

socket.io, namespace `/agents`, all events carrying JSON payloads typed in `packages/contracts`.

| Direction | Event | Payload |
|---|---|---|
| client → server | `thread.start` | `{}` → server allocates a ULID `threadId` |
| client → server | `thread.resume` | `{ threadId }` |
| client → server | `message` | `{ threadId, content }` |
| client → server | `confirm` | `{ threadId }` |
| client → server | `reject` | `{ threadId, notes?: string }` |
| server → client | `state` | `AgentStateSnapshot` — phase, messages, draftPayload, missingRequirements |
| server → client | `error` | RFC 9457 problem object |

A `state` event is emitted whenever the graph halts, which is the only moment the client can act. Token streaming is out of scope, so no intermediate events exist.

Alongside the socket there is a minimal REST surface: `/health/live`, `/health/ready`, and `GET /api/v1/threads/:id` returning the same snapshot for clients that want history without a socket.

## 6. Auth and tenant isolation

Browsers cannot set headers on a WebSocket upgrade, so the JWT is supplied in the socket.io handshake `auth.token` and verified in connection middleware — before the connection is established, so an unauthenticated client is refused rather than connected and then disconnected — by the shared `packages/auth` verifier — RS256 against a cached JWKS refreshed on an unrecognized `kid`, checking `iss`, `aud` and `exp`. A failed verification refuses the handshake, which the client observes as a connection error; no unauthenticated socket reaches an event handler.

Verified claims are stored on `socket.data` and every graph run is wrapped in the `TenantContext` `AsyncLocalStorage` scope, so `tenantId` reaches the dispatcher and the engine-client without being threaded through the graph signature.

**Tenant identity comes from the `custom:tenant_id` claim and from nothing else** — never from an event payload. Thread ownership is recorded in Redis at `thread:<threadId> → { tenantId, userId, createdAt }` with `THREAD_TTL_SECONDS` expiry. Resuming a thread whose stored `tenantId` differs from the socket's claim yields `thread-not-found`, never a distinguishable authorization error, for the same reason the Engine returns 404 rather than 403: a 403 confirms the thread exists.

Engine reads forward the **caller's** JWT rather than using a service account, so the Engine's own isolation applies unchanged and a compromised gateway still cannot read across tenants.

## 7. Error handling

Errors use RFC 9457 `application/problem+json` on the REST surface and the identical body on the socket `error` event, so both channels share type slugs. Every error carries a `traceId`.

| Condition | Status | `type` |
|---|---|---|
| Missing or invalid token | 401 | `unauthorized` |
| Thread absent, expired, or another tenant's | 404 | `thread-not-found` |
| Redraft attempts exhausted | 422 | `draft-attempts-exhausted` |
| Ollama unreachable or past `LLM_TIMEOUT_MS` | 503 | `llm-unavailable` |
| Engine unreachable or 5xx | 503 | `engine-unavailable` |
| SQS send failed | 502 | `dispatch-failed` |
| Event payload fails its contract schema | 422 | `invalid-event-payload` |

`llm-unavailable`, `engine-unavailable` and `dispatch-failed` preserve the checkpoint: the thread stays resumable at its last committed phase rather than being lost to a transient dependency failure. Only `dispatch-failed` is retryable by the client re-sending `confirm`, and the derived deduplication id makes that safe.

Structured JSON logging (pino) carries `traceId`, `tenantId`, `threadId` and `phase` on every line. Prompts and model completions are logged at debug level only, since conversations carry tenant business data.

## 8. Deviations from the PRD

**Bounded redraft loop.** The PRD states that validation failures "loop back to drafting silently". Unbounded, that is a hang against a local 7B model that cannot produce a valid diff for the request. The loop is bounded by `DRAFT_MAX_ATTEMPTS` (default 3), after which the graph returns to `gathering` and tells the user what it could not satisfy.

**Typed draft payload.** The PRD types `draftPayload` as `any`. It is typed as `BlueprintDiff`, the only shape the Engine's queue contract accepts.

**Explicit confirmation event.** The PRD implies the conversation itself carries confirmation. Confirmation is a separate socket event, because a model misreading rejection as assent would dispatch an unwanted schema change to a tenant's registry.

**Registry grounding read.** The PRD's node list has the agent drafting without reading current state. `loadRegistryNode` is added so the agent can see existing fields, which is what prevents duplicate-field proposals from reaching the Engine and failing at execute time.

## 9. Rejected alternatives

**A scripted fake LLM in Compose instead of Ollama** — would make e2e deterministic and fast, but the local stack would then never exercise a real model, and prompt regressions would surface only against hosted infrastructure. The `LlmProvider` port keeps the scripted double available where determinism actually matters, which is unit tests.

**Agents reading DynamoDB directly for the registry** — no Engine change needed, but it breaks the Engine's invariant that `DynamoRepository` is the only code constructing `PK`, duplicates key logic across services, and returns tenant isolation to a matter of reviewer vigilance.

**Grounding on entity samples rather than the registry** — listing a few products to infer attribute names needs no new endpoint, but is blind to `required` flags, field types and the registry version, so duplicate and conflicting proposals would reach the Engine and fail at execute time.

**Agent-initiated Engine writes (conversational product and event creation)** — a second output path, an Engine write client, and roughly double the graph's action surface, none of which the locked `PROPOSE_FLOW` contract can carry. Deferred.

**Token streaming over the socket** — better perceived latency, but the graph only produces actionable output at halts, and local model latency dominates anyway. The event protocol reserves room for it without committing now.

## 10. Testing strategy

Test-driven throughout: write the failing test, then implement.

The governing constraint is that a 7B local model is non-deterministic. **No test asserts on model prose.** Assertions target structure: which phase the graph reached, which fields the diff contains, what landed on the queue. `temperature: 0` and a fixed seed reduce variance but are not relied on for correctness.

**Unit** (no I/O, `ScriptedLlmProvider`): each node's state transition; the validation node's three rejection rules; attempt bounding at `DRAFT_MAX_ATTEMPTS`; deduplication id determinism and its sensitivity to payload changes; the thread ownership guard; socket event payload parsing.

**Integration** (real containers, no mocks): Redis checkpointer round-trip and resume after a simulated disconnect; the SQS producer against a real localstack FIFO queue, asserting `MessageGroupId` and that a repeated send with the same deduplication id yields one message; the engine-client against a real Engine container, including its 404 and 5xx paths.

**End to end** (full stack, real Ollama, real cognito-local token):

1. **Happy path** — connect, ask for `dietaryNeeds` on `Event`, answer the gathering question, receive `awaiting_confirmation` with a draft that parses as `BlueprintDiff`, send `confirm`, then assert exactly one message on the queue whose body parses with `EngineJobMessageSchema` and whose `MessageGroupId` equals the tenant.
2. **Cross-tenant thread** — tenant B resumes tenant A's `threadId` and receives `thread-not-found`.
3. **Resume** — disconnect mid-conversation, reconnect, and find phase and message history intact.
4. **Duplicate field** — propose a field already present in the registry; validation rejects it and nothing is dispatched.
5. **Cross-service loop** — after dispatch, the Engine's consumer creates the Flow at `status: 'proposed'`; executing it bumps the registry version, and `GET /schemas/Event` then shows the new field.

Test 5 is the acceptance gate for this spec: it is the only test that proves both services' halves of the SQS contract agree.

There is no coverage-percentage target. The gate is that those five end-to-end invariants exist and pass.

### Build order

Engine plan amendments (`packages/auth`, `GET /schemas`) → `packages/contracts` agent shapes → config and health → `LlmProvider` and Ollama in Compose → engine-client → graph nodes and checkpointer → dispatch → socket gateway → end-to-end suite. Each layer's tests pass before the next begins.

## 11. Out of scope

- Token streaming and intermediate progress events
- More than one target entity per thread
- Agent-initiated Engine writes (conversational CRUD)
- A hosted LLM provider implementation; the `LlmProvider` port exists so this is a later config change, not a rewrite
- Conversation compaction or summarization for long threads
- Flow backfill and destructive schema migrations, which the Engine spec also defers
- Role-based authorization beyond tenant membership
- AWS deployment: CDK, ECS, ALB, model hosting, secrets management
