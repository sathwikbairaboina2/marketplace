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

import { useOnboardingSocket } from './use-onboarding-socket';

const threadId = '01J0000000000000000000000A';

const snapshot = (messages: Array<{ role: 'user' | 'assistant'; content: string }>) => ({
  threadId,
  kind: 'onboarding' as const,
  phase: 'gathering' as const,
  messages,
  draft: null,
  setupPlan: null,
});

const connectAndSnapshot = async () => {
  await act(async () => {
    handlers.connect?.(undefined);
    handlers.state?.(snapshot([]));
  });
};

describe('useOnboardingSocket', () => {
  beforeEach(() => {
    sessionStorage.clear();
    emit.mockClear();
    disconnect.mockClear();
  });

  it('shows the owner message immediately and marks the turn pending', async () => {
    const { result } = renderHook(() => useOnboardingSocket());
    await connectAndSnapshot();

    await act(async () => result.current.send('I run a pottery studio'));

    expect(result.current.pending).toBe(true);
    expect(result.current.snapshot?.messages.at(-1)).toEqual({
      role: 'user',
      content: 'I run a pottery studio',
    });
  });

  it('drops the optimistic copy when the server snapshot arrives', async () => {
    const { result } = renderHook(() => useOnboardingSocket());
    await connectAndSnapshot();

    await act(async () => result.current.send('I run a pottery studio'));
    await act(async () => {
      handlers.state?.(
        snapshot([
          { role: 'user', content: 'I run a pottery studio' },
          { role: 'assistant', content: 'What do you sell?' },
        ]),
      );
    });

    expect(result.current.pending).toBe(false);
    expect(result.current.snapshot?.messages).toHaveLength(2);
  });

  it('opens a fresh thread when the stored one is gone, instead of dead-ending', async () => {
    // A thread id outlives the session that made it: signing out and back in
    // as another tenant leaves the previous tenant's id in sessionStorage.
    // Resuming it answers thread-not-found, and without this the wizard has no
    // thread, so every message the owner types is dropped in silence.
    sessionStorage.setItem('marketplace.onboardingThreadId', 'someone-elses-thread');
    const { result } = renderHook(() => useOnboardingSocket());

    await act(async () => {
      handlers.connect?.(undefined);
      handlers.error?.({
        type: 'https://marketplace.local/problems/thread-not-found',
        title: 'No such thread',
        detail: 'someone-elses-thread',
      });
    });

    expect(sessionStorage.getItem('marketplace.onboardingThreadId')).toBeNull();
    expect(emit).toHaveBeenCalledWith('thread.start', { kind: 'onboarding' });
    // Nothing here is the owner's to act on, so nothing is shown to them.
    expect(result.current.error).toBeNull();
  });

  it('still surfaces an agent error that is not a missing thread', async () => {
    const { result } = renderHook(() => useOnboardingSocket());
    await connectAndSnapshot();

    await act(async () => {
      handlers.error?.({
        type: 'https://marketplace.local/problems/agent-unavailable',
        title: 'Agent unavailable',
      });
    });

    expect(result.current.error).toBe('Agent unavailable');
  });

  it('does not echo a message it never sent, when there is no thread yet', async () => {
    const { result } = renderHook(() => useOnboardingSocket());
    await act(async () => {
      handlers.connect?.(undefined);
    });

    await act(async () => result.current.send('dropped'));

    expect(emit).not.toHaveBeenCalledWith('message', expect.anything());
    expect(result.current.pending).toBe(false);
  });
});
