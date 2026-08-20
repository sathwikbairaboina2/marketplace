'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  AGENT_EVENTS,
  OnboardingSnapshotSchema,
  type OnboardingSnapshot,
} from '@marketplace/contracts';
import { AGENTS_URL } from '../env';
import { getToken } from '../auth/auth-context';

// Its own key, not the schema assistant's: the two conversations are different
// threads on different graphs, and resuming one as the other 422s.
const THREAD_KEY = 'marketplace.onboardingThreadId';

/**
 * use-agent-socket's shape, for onboarding threads: thread.start declares the
 * kind, snapshots parse against the onboarding contract, and there is no
 * confirm/reject -- publishing is an HTTP action in the wizard.
 */
export function useOnboardingSocket() {
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null);
  // The owner's own message, held until the server echoes it back. A turn can
  // take tens of seconds against a local model, and without this the chat log
  // sits unchanged after a send -- indistinguishable from a dropped message.
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${AGENTS_URL}/agents`, { auth: { token: getToken() } });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setError(null);
      const existing = sessionStorage.getItem(THREAD_KEY);
      if (existing) socket.emit(AGENT_EVENTS.threadResume, { threadId: existing });
      else socket.emit(AGENT_EVENTS.threadStart, { kind: 'onboarding' });
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (err: Error) => setError(err.message));

    socket.on(AGENT_EVENTS.state, (payload: unknown) => {
      const parsed = OnboardingSnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        setError('Received a state snapshot this client cannot read');
        return;
      }
      sessionStorage.setItem(THREAD_KEY, parsed.data.threadId);
      setSnapshot(parsed.data);
      // The server snapshot is authoritative and already contains the message,
      // so the optimistic copy is dropped wholesale rather than reconciled.
      setOptimistic(null);
    });

    socket.on(AGENT_EVENTS.error, (problem: { title?: string; detail?: string }) => {
      setError([problem.title, problem.detail].filter(Boolean).join(': ') || 'agent error');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const threadId = snapshot?.threadId;

  const send = useCallback(
    (content: string) => {
      if (!threadId) return;
      setOptimistic(content);
      socketRef.current?.emit(AGENT_EVENTS.message, { threadId, content });
    },
    [threadId],
  );

  const withOptimistic =
    snapshot && optimistic
      ? { ...snapshot, messages: [...snapshot.messages, { role: 'user' as const, content: optimistic }] }
      : snapshot;

  return {
    snapshot: withOptimistic,
    connected,
    error,
    send,
    // True while a turn is in flight: the wizard renders a pending bubble so a
    // slow model reads as thinking rather than as broken.
    pending: optimistic !== null,
  };
}
