import { makeLoadRegistryNode } from './load-registry.node';
import { AgentState } from '../state';
import { EngineClient } from '../../engine-client/engine.client';

const ctx = {
  principal: { tenantId: 'tenant_a', userId: 'user-1', role: null },
  authToken: 'token-abc',
  threadId: '01J8Z5X9T7QK4W2M6N3P8R5V1C',
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
