import { Injectable } from '@nestjs/common';
import { CreateFlow, DynamicEntityType, FlowRecord, Page } from '@marketplace/contracts';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { entitySk, skPrefix } from '../persistence/keys';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem';
import { currentPrincipal } from '../common/tenant-context';

// The HTTP-facing shape of a flow. `FlowRecord` (from @marketplace/contracts) mirrors exactly
// what is stored in DynamoDB, including the single-table `PK`/`SK` attributes. Those are a
// persistence-layer implementation detail and are deliberately not part of the public API
// surface: clients should never see, depend on, or be able to parse the internal key scheme.
export type FlowResponse = Omit<FlowRecord, 'PK' | 'SK'>;

function toResponse(record: FlowRecord): FlowResponse {
  const { PK: _pk, SK: _sk, ...rest } = record;
  return rest;
}

@Injectable()
export class FlowsService {
  constructor(
    private readonly repo: DynamoRepository,
    private readonly registry: SchemaRegistryService,
  ) {}

  // Reused by Task 16's SQS consumer to create proposed flows from the AI agent service. A flow
  // is always created at `status: 'proposed'` here -- never auto-applied -- which is what keeps
  // a language model from silently mutating a tenant's data model; a human must call `execute`
  // to actually apply it.
  //
  // `id` is optional and defaults to a fresh `newId()` for the normal HTTP path (POST /flows),
  // where every proposal is a genuinely new Flow. The SQS consumer instead supplies a Flow id
  // deterministically derived from the source message's `MessageId`, and the write below uses
  // `putIfAbsent` rather than an unconditional `put` specifically so that path is idempotent on
  // the write itself: if the same message is ever processed twice -- a plain SQS redelivery, or
  // the consumer's own best-effort Redis dedupe claim being lost after an ambiguous write (the
  // Put committed but the client timed out before seeing the response) -- the second write for
  // the same id is a DynamoDB no-op, and the caller gets back the Flow that already exists
  // rather than a second, distinct one.
  async propose(input: CreateFlow, id: string = newId()): Promise<FlowResponse> {
    // `currentPrincipal()` covers both entry points: the HTTP path runs inside the JWT guard's
    // `runWithTenant`, and the SQS consumer runs inside its own `runWithTenant({ userId:
    // 'system:agents', ... })` (see `messaging/sqs-consumer.service.ts`) -- so an AI-proposed
    // Flow is attributed to that system identity rather than silently recording nothing.
    const record: FlowResponse = {
      entityType: 'Flow',
      id,
      targetEntity: input.targetEntity,
      actionType: input.actionType,
      status: 'proposed',
      blueprintDiff: input.blueprintDiff,
      createdAt: new Date().toISOString(),
      proposedBy: currentPrincipal().userId,
      executedBy: null,
      appliedAt: null,
      resultingVersion: null,
    };
    const written = await this.repo.putIfAbsent(entitySk('Flow', id), record);
    if (!written) return this.get(id);
    return record;
  }

  async execute(id: string): Promise<FlowResponse> {
    const flow = await this.get(id);

    // Idempotent: an already-applied flow is returned unchanged rather than re-applying the
    // diff, so a caller that executes twice (retry, double-click, ...) never bumps the registry
    // version a second time.
    if (flow.status === 'applied') return flow;

    if (flow.status === 'rejected') {
      // Reusing 'unsupported-schema-change' deliberately: the union has no closer fit for a
      // Flow state-machine violation, but this is a different failure than the registry ones
      // that type normally denotes -- nothing about the diff itself is unsupported here, the
      // Flow was simply rejected before it could be applied.
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

    const applied: FlowResponse = {
      ...flow,
      status: 'applied',
      executedBy: currentPrincipal().userId,
      appliedAt: new Date().toISOString(),
      resultingVersion,
    };
    await this.repo.put(entitySk('Flow', id), applied);
    return applied;
  }

  async get(id: string): Promise<FlowResponse> {
    // Cross-tenant access already 404s because `repo.get` is scoped to the current tenant's
    // partition -- a lookup from another tenant simply finds nothing. Unlike orders and
    // bookings, there is no further per-user ownership check here: a Flow is a tenant-wide
    // schema operation with no `userId` on the record, so tenant scoping alone is the correct
    // boundary -- any authenticated user of the tenant may view or execute a proposed flow.
    const found = await this.repo.get<FlowRecord>(entitySk('Flow', id));
    if (!found) throw new ProblemException('not-found', 404, 'Flow not found');
    return toResponse(found);
  }

  async list(limit: number, cursor: string | null): Promise<Page<FlowResponse>> {
    const page = await this.repo.queryPrefix<FlowRecord>(skPrefix('Flow'), { limit, cursor });
    return { items: page.items.map(toResponse), nextCursor: page.nextCursor };
  }
}
