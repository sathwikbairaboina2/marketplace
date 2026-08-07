import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const handlers: Record<string, (payload: unknown) => void> = {};
const emit = vi.fn();
const disconnect = vi.fn();
const socket = {
  on: (event: string, handler: (payload: unknown) => void) => {
    handlers[event] = handler;
  },
  emit,
  disconnect,
};

vi.mock('socket.io-client', () => ({ io: () => socket }));
vi.mock('../auth/auth-context', () => ({ getToken: () => 'tok' }));

import { useAgentSocket } from './use-agent-socket';

const snapshot = {
  threadId: '01J0000000000000000000000A',
  phase: 'awaiting_confirmation',
  targetEntity: 'Product',
  messages: [{ role: 'assistant', content: 'Add a colour field?' }],
  draftPayload: {
    addedFields: [{ name: 'colour', type: 'string', required: false, default: null }],
  },
  missingRequirements: [],
  validationErrors: [],
  dispatchedMessageId: null,
};

const connectAndSnapshot = async () => {
  await act(async () => {
    handlers.connect?.(undefined);
    handlers.state?.(snapshot);
  });
};

describe('useAgentSocket', () => {
  beforeEach(() => {
    sessionStorage.clear();
    emit.mockClear();
    disconnect.mockClear();
  });

  it('starts a thread on connect and stores the threadId', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await connectAndSnapshot();

    expect(emit).toHaveBeenCalledWith('thread.start');
    expect(result.current.snapshot?.phase).toBe('awaiting_confirmation');
    expect(sessionStorage.getItem('marketplace.threadId')).toBe(snapshot.threadId);
  });

  it('resumes an existing thread instead of starting a new one', async () => {
    sessionStorage.setItem('marketplace.threadId', snapshot.threadId);
    renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.connect?.(undefined);
    });
    expect(emit).toHaveBeenCalledWith('thread.resume', { threadId: snapshot.threadId });
    expect(emit).not.toHaveBeenCalledWith('thread.start');
  });

  it('sends message, confirm and reject with the current threadId', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await connectAndSnapshot();

    act(() => result.current.send('add colour'));
    expect(emit).toHaveBeenCalledWith('message', {
      threadId: snapshot.threadId,
      content: 'add colour',
    });

    act(() => result.current.confirm());
    expect(emit).toHaveBeenCalledWith('confirm', { threadId: snapshot.threadId });

    act(() => result.current.reject('no thanks'));
    expect(emit).toHaveBeenCalledWith('reject', {
      threadId: snapshot.threadId,
      notes: 'no thanks',
    });
  });

  it('emits nothing before a snapshot has established a threadId', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.connect?.(undefined);
    });
    emit.mockClear();

    act(() => result.current.send('too early'));
    act(() => result.current.confirm());
    expect(emit).not.toHaveBeenCalled();
  });

  it('surfaces an error event as a message', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.error?.({ title: 'Rejected', detail: 'bad thread' });
    });
    expect(result.current.error).toContain('bad thread');
  });

  // The schema is deliberately non-strict so an additive server field does not
  // break an older client -- but a genuinely unreadable payload must not be
  // rendered as if it were valid.
  it('reports a snapshot it cannot parse instead of rendering it', async () => {
    const { result } = renderHook(() => useAgentSocket());
    await act(async () => {
      handlers.state?.({ threadId: 'not-a-ulid', phase: 'nonsense' });
    });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toMatch(/cannot read/i);
  });

  it('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useAgentSocket());
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
