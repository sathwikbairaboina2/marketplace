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
