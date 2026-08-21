'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  AGENT_EVENTS,
  AgentStateSnapshotSchema,
  type AgentStateSnapshot,
} from '@marketplace/contracts';
import { AGENTS_URL } from '../env';
import { getToken } from '../auth/auth-context';
import { AGENT_THREAD_KEY as THREAD_KEY, isThreadNotFound } from './thread-storage';


export function useAgentSocket() {
  const [snapshot, setSnapshot] = useState<AgentStateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Browsers cannot set headers on a WebSocket upgrade, so the gateway reads
    // the token from the handshake instead -- see ChatGateway.afterInit, which
    // verifies it as connection middleware and rejects with `connect_error`
    // rather than accepting and then tearing down.
    const socket = io(`${AGENTS_URL}/agents`, { auth: { token: getToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      const existing = sessionStorage.getItem(THREAD_KEY);
      if (existing) socket.emit(AGENT_EVENTS.threadResume, { threadId: existing });
      else socket.emit(AGENT_EVENTS.threadStart);
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: Error) => setError(err.message));

    socket.on(AGENT_EVENTS.state, (payload: unknown) => {
      // AgentStateSnapshotSchema is deliberately non-strict, so a field the
      // server adds later does not break this client. A payload that fails
      // outright is a different matter and must not render as if it were valid.
      const parsed = AgentStateSnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        setError('Received a state snapshot this client cannot read');
        return;
      }
      sessionStorage.setItem(THREAD_KEY, parsed.data.threadId);
      setSnapshot(parsed.data);
    });

    socket.on(AGENT_EVENTS.error, (problem: { type?: string; title?: string; detail?: string }) => {
      // A leftover thread id, same as the onboarding socket next door: open a
      // fresh thread rather than stranding the assistant with nothing to send on.
      if (isThreadNotFound(problem)) {
        sessionStorage.removeItem(THREAD_KEY);
        socket.emit(AGENT_EVENTS.threadStart);
        return;
      }
      setError([problem.title, problem.detail].filter(Boolean).join(': ') || 'agent error');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Every outbound event needs the threadId the server assigned, so all three
  // are no-ops until the first snapshot arrives.
  const threadId = snapshot?.threadId;

  const send = useCallback(
    (content: string) => {
      if (threadId) socketRef.current?.emit(AGENT_EVENTS.message, { threadId, content });
    },
    [threadId],
  );

  const confirm = useCallback(() => {
    if (threadId) socketRef.current?.emit(AGENT_EVENTS.confirm, { threadId });
  }, [threadId]);

  const reject = useCallback(
    (notes?: string) => {
      if (threadId) socketRef.current?.emit(AGENT_EVENTS.reject, { threadId, notes });
    },
    [threadId],
  );

  return { snapshot, connected, error, send, confirm, reject };
}
