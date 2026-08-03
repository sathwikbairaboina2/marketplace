import { io, Socket } from 'socket.io-client';
import { AgentStateSnapshot } from '@marketplace/contracts';
import { agentsBaseUrl } from '../setup';

export function connectSocket(token: string): Promise<Socket> {
  const socket = io(`${agentsBaseUrl}/agents`, {
    auth: { token },
    transports: ['websocket'],
    forceNew: true,
  });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('socket did not connect')), 15_000);
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
