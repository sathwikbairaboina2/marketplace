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
