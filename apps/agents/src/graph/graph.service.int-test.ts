import { ulid } from 'ulid';
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { ScriptedLlmProvider } from '../llm/scripted.provider';
import { EngineClient } from '../engine-client/engine.client';
import { DispatchService } from '../dispatch/dispatch.service';
import { GraphService } from './graph.service';
import { createCheckpointer } from './checkpointer';
import { EnvConfig } from '../config/env.schema';

/**
 * Every `createCheckpointer` call opens a real Redis connection via
 * `RedisSaver`'s underlying `redis` client; none of them are closed by
 * anything else in this file, so each one is tracked here and disposed in an
 * `afterAll` below. Without this, Jest reports open handles after the run.
 */
const openCheckpointers: RedisSaver[] = [];

async function trackedCheckpointer(env: EnvConfig): Promise<RedisSaver> {
  const checkpointer = await createCheckpointer(env);
  openCheckpointers.push(checkpointer);
  return checkpointer;
}

afterAll(async () => {
  await Promise.all(openCheckpointers.map((c) => c.end()));
});

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
    service = new GraphService(env, llm, engine, dispatch, await trackedCheckpointer(env));
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
    service = new GraphService(env, llm, engine, dispatch, await trackedCheckpointer(env));
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
    const service = new GraphService(env, llm, engine, dispatch as never, await trackedCheckpointer(env));

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
    const service = new GraphService(env, llm, engine, dispatch as never, await trackedCheckpointer(env));

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

  it('does not dispatch or report done for a premature confirm sent mid-gathering on a new proposal', async () => {
    const llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-a') };
    const service = new GraphService(env, llm, engine, dispatch as never, await trackedCheckpointer(env));

    const threadId = ulid();

    // Proposal A: dispatched and confirmed, leaving dispatchedMessageId set.
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });
    await service.run({ threadId, ctx, action: 'message', content: 'add dietaryNeeds text to events' });
    const confirmA = await service.run({ threadId, ctx, action: 'confirm' });
    expect(confirmA.phase).toBe('done');
    expect(confirmA.dispatchedMessageId).toBe('msg-a');

    // A new message on the same thread that does NOT reach a fresh proposal:
    // requirementCheck halts at `gathering` again, leaving the stale
    // draftPayload and dispatchedMessageId from proposal A untouched.
    llm.pushStructured({ satisfied: false, missing: ['field name'], question: 'Which field this time?' });
    const midGathering = await service.run({ threadId, ctx, action: 'message', content: 'one more thing' });
    expect(midGathering.phase).toBe('gathering');

    // A premature confirm now must not hit the stale `dispatchedMessageId`
    // short-circuit: with the old `phase === 'awaiting_confirmation' ||
    // dispatchedMessageId` router, this would route straight to the dispatch
    // node, which would itself short-circuit on the stale id and report
    // `phase: 'done'` without ever calling dispatch() again -- silently
    // "confirming" a proposal that was never drafted or shown to the user.
    llm.pushStructured({ satisfied: false, missing: ['field name'], question: 'Which field this time?' });
    const prematureConfirm = await service.run({ threadId, ctx, action: 'confirm' });
    expect(prematureConfirm.phase).not.toBe('done');
    expect(prematureConfirm.phase).toBe('gathering');
    expect(dispatch.dispatch).toHaveBeenCalledTimes(1);
  });

  it('gives a second proposal on the same thread the full draft-attempt budget, not leftovers from the first', async () => {
    const llm = new ScriptedLlmProvider();
    const engine = {
      getSchema: jest.fn().mockResolvedValue({ version: 0, fields: {} }),
    } as unknown as EngineClient;
    const dispatch = { dispatch: jest.fn().mockResolvedValue('msg-a') };
    const service = new GraphService(env, llm, engine, dispatch as never, await trackedCheckpointer(env));

    const threadId = ulid();

    // Proposal A: succeeds on its first and only draft attempt.
    llm.pushStructured({ targetEntity: 'Event', clarification: '' });
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'dietaryNeeds', type: 'string', required: false }] });
    const proposalA = await service.run({
      threadId,
      ctx,
      action: 'message',
      content: 'add dietaryNeeds text to events',
    });
    expect(proposalA.phase).toBe('awaiting_confirmation');

    // Proposal B, same thread: three consecutive drafts that each collide with
    // Event's built-in `capacity` field, so every one of them is rejected by
    // validate. This should burn through the FULL DRAFT_MAX_ATTEMPTS budget
    // before giving up -- not just whatever proposal A's single successful
    // attempt happened to leave behind. If validate's success branch left
    // draftAttempts uncleared, proposal B would start already "spent" from
    // proposal A and give up after only two attempts, leaving the third
    // scripted response here unconsumed.
    llm.pushStructured({ satisfied: true, missing: [], question: '' });
    llm.pushStructured({ addedFields: [{ name: 'capacity', type: 'number', required: false }] });
    llm.pushStructured({ addedFields: [{ name: 'capacity', type: 'number', required: false }] });
    llm.pushStructured({ addedFields: [{ name: 'capacity', type: 'number', required: false }] });

    const callsBefore = llm.calls.length;
    const proposalB = await service.run({
      threadId,
      ctx,
      action: 'message',
      content: 'also add a capacity override',
    });
    const callsConsumed = llm.calls.length - callsBefore;

    expect(proposalB.phase).toBe('gathering');
    expect(proposalB.draftPayload).toBeNull();
    expect(proposalB.validationErrors.some((e) => e.includes('capacity'))).toBe(true);
    expect(proposalB.messages[proposalB.messages.length - 1]?.content).toContain(
      `after ${env.DRAFT_MAX_ATTEMPTS} attempts`,
    );
    // 1 requirementCheck call plus all three scripted drafts: the full budget,
    // not the 2 that proposal A's carried-over draftAttempts would allow.
    expect(callsConsumed).toBe(1 + env.DRAFT_MAX_ATTEMPTS);
  });
});
