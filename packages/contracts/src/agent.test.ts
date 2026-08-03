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
