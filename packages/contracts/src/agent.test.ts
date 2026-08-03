import {
  AgentStateSnapshotSchema,
  AGENT_EVENTS,
  ConfirmSchema,
  RejectSchema,
  SendMessageSchema,
  ThreadResumeSchema,
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

  // Each of these four wire schemas is .strict(): an unrecognized key (a
  // client typo, or a stale field) must be rejected outright rather than
  // silently stripped, or a client/server disagreement would go undetected.
  it('rejects a thread.resume payload with an unknown key', () => {
    expect(() => ThreadResumeSchema.parse({ threadId: ulid, extra: 'x' })).toThrow();
  });

  it('rejects a message payload with an unknown key (e.g. a typo like `contnet`)', () => {
    expect(() => SendMessageSchema.parse({ threadId: ulid, content: 'hi', contnet: 'hi' })).toThrow();
  });

  it('rejects a confirm payload with an unknown key', () => {
    expect(() => ConfirmSchema.parse({ threadId: ulid, extra: 'x' })).toThrow();
  });

  it('rejects a reject payload with an unknown key', () => {
    expect(() => RejectSchema.parse({ threadId: ulid, notes: 'no', extra: 'x' })).toThrow();
  });
});
