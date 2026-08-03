import { ulid } from 'ulid';
import { AgentStateSnapshotSchema } from '@marketplace/contracts';
import { ScriptedLlmProvider } from '../llm/scripted.provider';
import { EngineClient } from '../engine-client/engine.client';
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
    service = new GraphService(env, llm, engine, await createCheckpointer(env));
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
    service = new GraphService(env, llm, engine, await createCheckpointer(env));
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
