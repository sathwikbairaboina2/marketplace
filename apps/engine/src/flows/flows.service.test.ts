import { FlowRecord } from '@marketplace/contracts';
import { FlowsService } from './flows.service';
import { DynamoRepository } from '../persistence/dynamo.repository';
import { SchemaRegistryService } from '../registry/schema-registry.service';
import { ProblemException } from '../common/problem';

// `execute()`'s `rejected` and `applied` branches have no e2e path today: nothing in the system
// can produce a `rejected` Flow (there is no reject endpoint in v1) or exercise idempotent
// re-execution's internal short-circuit beyond the observable status code an e2e test can see.
// A stubbed repository is the only way to construct that state and confirm the mechanism -- not
// just that an error is thrown, but that `applyAddFields` is never called, which is the actual
// guarantee: a rejected or already-applied Flow's diff can never reach the registry a second
// (or first, in the rejected case) time.

function makeFlow(overrides: Partial<FlowRecord> = {}): FlowRecord {
  return {
    PK: 'TENANT#tenant_flows_test',
    SK: 'FLOW#01ABC',
    entityType: 'Flow',
    id: '01ABC',
    targetEntity: 'Product',
    actionType: 'ADD_FIELDS',
    status: 'proposed',
    blueprintDiff: { addedFields: [{ name: 'color', type: 'string', required: false, default: null }] },
    createdAt: '2026-01-01T00:00:00.000Z',
    appliedAt: null,
    resultingVersion: null,
    ...overrides,
  };
}

describe('FlowsService.execute', () => {
  it('rejects a rejected Flow with a 422 and never calls applyAddFields', async () => {
    const flow = makeFlow({ status: 'rejected' });
    const repo = { get: jest.fn().mockResolvedValue(flow), put: jest.fn() };
    const registry = { applyAddFields: jest.fn() };
    const service = new FlowsService(
      repo as unknown as DynamoRepository,
      registry as unknown as SchemaRegistryService,
    );

    let error: unknown;
    try {
      await service.execute(flow.id);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ProblemException);
    expect((error as ProblemException).problem).toMatchObject({ status: 422 });

    // The actual guarantee is that the diff can never reach the registry, not merely that an
    // error was thrown -- a rejected flow's diff must never be applied, under any circumstance.
    expect(registry.applyAddFields).not.toHaveBeenCalled();
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('returns an already-applied Flow unchanged and never calls applyAddFields again', async () => {
    const flow = makeFlow({ status: 'applied', appliedAt: '2026-01-01T00:00:01.000Z', resultingVersion: 3 });
    const repo = { get: jest.fn().mockResolvedValue(flow), put: jest.fn() };
    const registry = { applyAddFields: jest.fn() };
    const service = new FlowsService(
      repo as unknown as DynamoRepository,
      registry as unknown as SchemaRegistryService,
    );

    const result = await service.execute(flow.id);

    const { PK: _pk, SK: _sk, ...expected } = flow;
    expect(result).toEqual(expected);

    // The actual guarantee is that a second execution can never re-apply the diff, not just
    // that the response happens to look the same.
    expect(registry.applyAddFields).not.toHaveBeenCalled();
    expect(repo.put).not.toHaveBeenCalled();
  });
});
