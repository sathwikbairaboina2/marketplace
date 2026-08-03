import { ulid } from 'ulid';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { ScriptedLlmProvider } from '../llm/scripted.provider';
import { EngineClient } from '../engine-client/engine.client';
import { DispatchService } from '../dispatch/dispatch.service';
import { GraphService } from './graph.service';
import { createCheckpointer } from './checkpointer';
import { EnvConfig } from '../config/env.schema';

const env = {
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  DRAFT_MAX_ATTEMPTS: 3,
  THREAD_TTL_SECONDS: 3600,
} as EnvConfig;

const ctx = {
  principal: { tenantId: 'tenant_a', userId: 'user-1', role: null },
  authToken: 'token-abc',
};

jest.setTimeout(60_000);

describe('GraphService persistence', () => {
  let llm: ScriptedLlmProvider;
  let service: GraphService;

  beforeAll(async () => {
    llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-stub') } as unknown as DispatchService;
    service = new GraphService(env, llm, engine, dispatch, await createCheckpointer(env));
  });

  it('halts at gathering and remembers the conversation across runs', async () => {
    const threadId = ulid();

    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type?' });
    const first = await service.run({ threadId, ctx, action: 'message', content: 'I need a new field' });
    expect(first.phase).toBe('gathering');
    expect(first.messages).toHaveLength(2);

    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    // The graph now continues past loadRegistry into requirementCheck; this scenario is only
    // about intent persisting across runs, so the request is left underspecified to halt there
    // without needing to script the drafting/validation nodes too.
    llm.pushStructured({ satisfied: false, missing: ['field name'], question: 'Which field?' });
    const second = await service.run({ threadId, ctx, action: 'message', content: 'events' });
    expect(second.targetEntity).toBe('Event');
    // The first exchange is still there: nothing was lost between runs.
    expect(second.messages.length).toBeGreaterThanOrEqual(3);
  });

  it('reads a thread back without running the graph', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'none', clarification: 'Which record type?' });
    await service.run({ threadId, ctx, action: 'message', content: 'hello' });

    const snapshot = await service.snapshot(threadId);
    expect(snapshot.threadId).toBe(threadId);
    expect(snapshot.phase).toBe('gathering');
  });

  it('keeps threads independent', async () => {
    const a = ulid();
    const b = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: false, missing: ['field name'], question: 'Which field?' });
    await service.run({ threadId: a, ctx, action: 'message', content: 'events' });

    const snapshot = await service.snapshot(b);
    expect(snapshot.messages).toEqual([]);
  });

  it('returns a schema-valid snapshot for a thread that was never run', async () => {
    const threadId = ulid();
    const snapshot = await service.snapshot(threadId);
    expect(() => AgentStateSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

describe('GraphService full drafting path', () => {
  let llm: ScriptedLlmProvider;
  let service: GraphService;

  beforeAll(async () => {
    llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-stub') } as unknown as DispatchService;
    service = new GraphService(env, llm, engine, dispatch, await createCheckpointer(env));
  });

  it('runs intent to awaiting_confirmation in one pass', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });

    const out = await service.run({
      threadId,
      ctx,
      action: 'message',
      content: 'add a dietaryNeeds text field to events',
    });

    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.draftPayload).toEqual({
      addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }],
    });
  });

  it('redrafts once after a validation failure, then succeeds', async () => {
    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    // First draft collides with a core field; second one does not.
    llm.pushStructured({ addedFields: [{ name: 'capacity', type: 'number', required: false }] });
    llm.pushStructured({ addedFields: [{ name: 'extraSeats', type: 'number', required: false }] });

    const out = await service.run({ threadId, ctx, action: 'message', content: 'more seats' });
    expect(out.phase).toBe('awaiting_confirmation');
    expect(out.draftPayload?.addedFields[0].name).toBe('extraSeats');
  });
});

describe('GraphService confirmation', () => {
  it('dispatches exactly once even if confirm arrives twice', async () => {
    const llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-1') };
    const service = new GraphService(env, llm, engine, dispatch as never, await createCheckpointer(env));

    const threadId = ulid();
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });
    await service.run({ threadId, ctx, action: 'message', content: 'add dietaryNeeds text to events' });

    const first = await service.run({ threadId, ctx, action: 'confirm' });
    const second = await service.run({ threadId, ctx, action: 'confirm' });

    expect(first.phase).toBe('done');
    expect(second.phase).toBe('done');
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches a second, distinct proposal on the same thread instead of hitting a stale dispatch guard', async () => {
    const llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValueOnce('msg-a').mockResolvedValueOnce('msg-b') };
    const service = new GraphService(env, llm, engine, dispatch as never, await createCheckpointer(env));

    const threadId = ulid();

    // Proposal A: dispatched and confirmed.
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });
    await service.run({ threadId, ctx, action: 'message', content: 'add dietaryNeeds text to events' });
    const confirmA = await service.run({ threadId, ctx, action: 'confirm' });
    expect(confirmA.phase).toBe('done');
    expect(confirmA.dispatchedMessageId).toBe('msg-a');

    // Same thread continues to a second, distinct proposal. If validate did
    // not clear the stale dispatchedMessageId from proposal A, the dispatch
    // node's guard would fire here and silently report success without ever
    // calling DispatchService.dispatch() for proposal B.
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'accessibilityNotes', type: 'string', required: false }] });
    await service.run({ threadId, ctx, action: 'message', content: 'also add accessibilityNotes text' });
    const confirmB = await service.run({ threadId, ctx, action: 'confirm' });
    expect(confirmB.phase).toBe('done');
    expect(confirmB.dispatchedMessageId).toBe('msg-b');

    expect(dispatch.dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        payload: { addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false, default: null }] },
      }),
    );
    expect(dispatch.dispatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        payload: { addedFields: [{ name: 'accessibilityNotes', type: 'string', required: false, default: null }] },
      }),
    );

    // The double-confirm guard must still hold for proposal B: repeating the
    // confirm must not dispatch it a third time.
    const repeatB = await service.run({ threadId, ctx, action: 'confirm' });
    expect(repeatB.phase).toBe('done');
    expect(dispatch.dispatch).toHaveBeenCalledTimes(2);
  });
});
