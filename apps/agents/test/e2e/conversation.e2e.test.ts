import { Socket } from 'socket.io-client';
import { engineBaseUrl, waitForAgentsHealthy } from './setup';
import { tokenFor } from './helpers/auth';
import { connectSocket, waitForError, waitForState } from './helpers/socket';
import { driveTo, driveUntil, startThread } from './helpers/converse';

const tenantId = `tenant_conv_${Math.random().toString(36).slice(2, 8)}`;
const username = `conv-${Date.now()}@example.com`;

const FIELD = 'dietaryNeeds';
const OPENING = `Add a text field called ${FIELD} to events so we can record what attendees can eat.`;
const FOLLOW_UP = `The field is named ${FIELD} and its type is text. It is optional.`;

jest.setTimeout(600_000);

async function engineHeaders(): Promise<Record<string, string>> {
  return {
    authorization: `Bearer ${await tokenFor(tenantId, username)}`,
    'content-type': 'application/json',
  };
}

async function schemaVersion(): Promise<{ version: number; fields: Record<string, unknown> }> {
  const res = await fetch(`${engineBaseUrl}/api/v1/schemas/Event`, { headers: await engineHeaders() });
  return (await res.json()) as { version: number; fields: Record<string, unknown> };
}

async function waitForProposedFlow(field: string, timeoutMs = 60_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${engineBaseUrl}/api/v1/flows?limit=50`, { headers: await engineHeaders() });
    const { items } = (await res.json()) as {
      items: { id: string; status: string; blueprintDiff: { addedFields: { name: string }[] } }[];
    };
    const match = items.find((f) => f.blueprintDiff.addedFields.some((a) => a.name === field));
    if (match) return match.id;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function countProposedFlows(field: string): Promise<number> {
  const res = await fetch(`${engineBaseUrl}/api/v1/flows?limit=50`, { headers: await engineHeaders() });
  const { items } = (await res.json()) as {
    items: { blueprintDiff: { addedFields: { name: string }[] } }[];
  };
  return items.filter((f) => f.blueprintDiff.addedFields.some((a) => a.name === field)).length;
}

/**
 * Polls up to `timeoutMs` for a NEW flow proposing `field` to appear beyond
 * `baseline`. Returns the count observed when the wait ends -- either because
 * it grew past baseline, or because the timeout elapsed with no growth. This
 * exists (rather than reusing `waitForProposedFlow`) because a flow for
 * `field` may already exist from an earlier, legitimate proposal: finding
 * *a* match is not evidence of anything, only finding *more* matches than
 * before is.
 */
async function waitForNewProposedFlowCount(field: string, baseline: number, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let count = baseline;
  while (Date.now() < deadline) {
    count = await countProposedFlows(field);
    if (count > baseline) return count;
    await new Promise((r) => setTimeout(r, 500));
  }
  return count;
}

describe('agent conversation', () => {
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  async function open(tenant: string, user: string): Promise<Socket> {
    const socket = await connectSocket(await tokenFor(tenant, user));
    sockets.push(socket);
    return socket;
  }

  it('drafts a valid proposal, dispatches it on confirmation, and the engine proposes a flow', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);

    const drafted = await driveTo(socket, threadId, OPENING, FOLLOW_UP, 'awaiting_confirmation');

    // Structure, never prose.
    expect(drafted.targetEntity).toBe('Event');
    expect(drafted.draftPayload?.addedFields.map((f) => f.name)).toContain(FIELD);

    const before = await schemaVersion();

    const confirmed = waitForState(socket, (s) => s.phase === 'done');
    socket.emit('confirm', { threadId });
    const done = await confirmed;
    expect(done.dispatchedMessageId).not.toBeNull();

    // Asserted through the Engine rather than by reading the queue: the Engine's
    // consumer is running and would race a direct ReceiveMessage.
    const flowId = await waitForProposedFlow(FIELD);
    expect(flowId).not.toBeNull();

    // The proposal is not applied until a human executes it.
    expect((await schemaVersion()).version).toBe(before.version);

    const executed = await fetch(`${engineBaseUrl}/api/v1/flows/${flowId}/execute`, {
      method: 'POST',
      headers: await engineHeaders(),
    });
    expect(executed.status).toBe(200);

    const after = await schemaVersion();
    expect(after.version).toBe(before.version + 1);
    expect(after.fields[FIELD]).toBeDefined();
  });

  // Depends on the previous test: FIELD only exists in the tenant's registry
  // once that test's Flow has been executed above. Keep this ordered after it
  // rather than making it independent -- do not reorder these two casually.
  it('refuses to propose a field that already exists', async () => {
    // Runs after the first test, so FIELD is now in the registry, and that
    // test's Flow execution already created one proposed flow for FIELD --
    // hence baselining the count below rather than asserting "no flow".
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);
    const baseline = await countProposedFlows(FIELD);

    // driveTo('gathering') would exit on the very FIRST turn here: 'gathering'
    // is also a fresh thread's default phase and the phase requirementCheck
    // sets while still asking a clarifying question, so it can be satisfied
    // before validate ever runs. Driving until validationErrors is populated
    // instead forces the run through drafting and validation, which is the
    // invariant this test exists to cover.
    const snapshot = await driveUntil(
      socket,
      threadId,
      `Add a text field called ${FIELD} to events.`,
      `It is called ${FIELD} and it is text.`,
      (s) => s.validationErrors.length > 0,
      'validationErrors populated',
    );

    expect(snapshot.validationErrors.some((e) => e.includes(FIELD))).toBe(true);
    expect(snapshot.dispatchedMessageId).toBeNull();

    const afterCount = await waitForNewProposedFlowCount(FIELD, baseline, 10_000);
    expect(afterCount).toBe(baseline);
  });

  it('resumes a conversation after a disconnect with its history intact', async () => {
    // A field name of its own, not FIELD: by this point test 1 has executed a Flow that
    // permanently added FIELD to this tenant's Event registry, so re-proposing FIELD here
    // would be correctly refused as a duplicate (the same path invariant 2 exercises) and
    // this test -- which is about resume, not about drafting -- would never reach
    // awaiting_confirmation. That refusal is deterministic, not a flaky model turn budget,
    // so a fresh field sidesteps it rather than papering over it.
    const resumeField = `resume_${Math.random().toString(36).slice(2, 6)}`;
    const opening = `Add a text field called ${resumeField} to events.`;
    const followUp = `It is called ${resumeField} and it is text.`;

    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);
    const first = await driveTo(socket, threadId, opening, followUp, 'awaiting_confirmation');
    const messageCount = first.messages.length;

    socket.disconnect();

    const reconnected = await open(tenantId, username);
    const resumed = waitForState(reconnected, () => true, 15_000);
    reconnected.emit('thread.resume', { threadId });
    const snapshot = await resumed;

    expect(snapshot.phase).toBe('awaiting_confirmation');
    expect(snapshot.messages).toHaveLength(messageCount);
    expect(snapshot.draftPayload).toEqual(first.draftPayload);
  });

  it('hides a thread from another tenant', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);

    const otherTenant = `tenant_conv_other_${Math.random().toString(36).slice(2, 8)}`;
    const intruder = await open(otherTenant, `intruder-${Date.now()}@example.com`);

    const pending = waitForError(intruder);
    intruder.emit('thread.resume', { threadId });
    expect((await pending).status).toBe(404);
  });

  it('discards a rejected proposal without dispatching', async () => {
    const socket = await open(tenantId, username);
    const threadId = await startThread(socket);
    const field = `notes_${Math.random().toString(36).slice(2, 6)}`;

    await driveTo(
      socket,
      threadId,
      `Add a text field called ${field} to events.`,
      `It is called ${field} and it is text.`,
      'awaiting_confirmation',
    );

    const rejected = waitForState(socket, (s) => s.phase === 'done');
    socket.emit('reject', { threadId });
    const snapshot = await rejected;

    expect(snapshot.dispatchedMessageId).toBeNull();
    expect(snapshot.draftPayload).toBeNull();
    expect(await waitForProposedFlow(field, 10_000)).toBeNull();
  });
});
