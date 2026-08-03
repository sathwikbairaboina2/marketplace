import { Socket } from 'socket.io-client';
import { agentsBaseUrl, waitForAgentsHealthy } from './setup';
import { tokenFor } from './helpers/auth';
import { connectSocket, waitForError, waitForState } from './helpers/socket';

const tenantA = `tenant_chat_a_${Math.random().toString(36).slice(2, 8)}`;
const tenantB = `tenant_chat_b_${Math.random().toString(36).slice(2, 8)}`;

describe('chat gateway', () => {
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await waitForAgentsHealthy();
  });

  afterAll(() => {
    for (const socket of sockets) socket.disconnect();
  });

  async function open(tenantId: string): Promise<Socket> {
    const token = await tokenFor(tenantId, `chat-${tenantId}@example.com`);
    const socket = await connectSocket(token);
    sockets.push(socket);
    return socket;
  }

  it('refuses a connection with no token', async () => {
    // Handshake middleware rejects, so this surfaces as `connect_error` rather
    // than a connection that opens and is then closed.
    await expect(connectSocket('')).rejects.toBeDefined();
  });

  it('refuses a connection with a malformed token', async () => {
    await expect(connectSocket('not-a-jwt')).rejects.toBeDefined();
  });

  it('starts a thread and returns an empty snapshot', async () => {
    const socket = await open(tenantA);
    const pending = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const snapshot = await pending;

    expect(snapshot.threadId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(snapshot.phase).toBe('gathering');
    expect(snapshot.messages).toEqual([]);
  });

  it('rejects an event payload that fails its contract', async () => {
    const socket = await open(tenantA);
    const pending = waitForError(socket);
    socket.emit('message', { threadId: 'not-a-ulid', content: 'hi' });
    const problem = await pending;
    expect(problem.status).toBe(422);
  });

  it('hides another tenant thread behind thread-not-found', async () => {
    const a = await open(tenantA);
    const started = waitForState(a, () => true, 15_000);
    a.emit('thread.start', {});
    const { threadId } = await started;

    const b = await open(tenantB);
    const pending = waitForError(b);
    b.emit('thread.resume', { threadId });
    const problem = await pending;

    expect(problem.status).toBe(404);
    expect(problem.type).toContain('thread-not-found');
  });

  it('serves the same snapshot over HTTP', async () => {
    const socket = await open(tenantA);
    const started = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const { threadId } = await started;

    const token = await tokenFor(tenantA, `chat-${tenantA}@example.com`);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${threadId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ threadId, phase: 'gathering' });
  });

  it('refuses an HTTP thread read from another tenant', async () => {
    const socket = await open(tenantA);
    const started = waitForState(socket, () => true, 15_000);
    socket.emit('thread.start', {});
    const { threadId } = await started;

    const token = await tokenFor(tenantB, `chat-${tenantB}@example.com`);
    const res = await fetch(`${agentsBaseUrl}/api/v1/threads/${threadId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
