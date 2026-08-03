import { io, Socket } from 'socket.io-client';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { agentsBaseUrl } from '../setup';

export function connectSocket(token: string): Promise<Socket> {
  const socket = io(`${agentsBaseUrl}/agents`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
    // socket.io-client's Manager retries a failed handshake with backoff by
    // default, even on the very first connection attempt. Without this, a
    // refused handshake (missing/malformed token) leaves a reconnect timer
    // running in the background -- exactly the kind of dangling handle that
    // keeps a Jest worker alive after the test that opened it has finished.
    reconnection: false,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket did not connect'));
    }, 15_000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    // A refused handshake must not leave the client behind either: close it
    // here rather than relying on the caller, since the two rejection tests
    // never get a reference to hand to a tracked disconnect() in afterAll.
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

export function waitForState(
  socket: Socket,
  predicate: (s: AgentStateSnapshot) => boolean = () => true,
  timeoutMs = 240_000,
): Promise<AgentStateSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for state')), timeoutMs);
    const onState = (snapshot: AgentStateSnapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timer);
      socket.off('state', onState);
      resolve(snapshot);
    };
    socket.on('state', onState);
  });
}

export function waitForError(socket: Socket, timeoutMs = 15_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for error')), timeoutMs);
    socket.once('error', (problem: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(problem);
    });
  });
}
