import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFlowArrival } from './use-flow-arrival';
import * as api from '../api/flows';

const page = (ids: string[]) =>
  ({ items: ids.map((id) => ({ id })), nextCursor: null }) as Awaited<
    ReturnType<typeof api.listFlows>
  >;

describe('useFlowArrival', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops waiting once a new flow appears', async () => {
    const spy = vi
      .spyOn(api, 'listFlows')
      .mockResolvedValueOnce(page([]))
      .mockResolvedValue(page(['f1']));

    const { result } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.waiting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.waiting).toBe(false);
    expect(result.current.reloadToken).toBeGreaterThan(0);
    expect(spy).toHaveBeenCalled();
  });

  // Nothing is broken at 30 seconds -- the queue is merely slow -- so this must
  // not present as an error.
  it('gives up after 30 seconds without treating it as a failure', async () => {
    vi.spyOn(api, 'listFlows').mockResolvedValue(page([]));

    const { result } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(result.current.waiting).toBe(false);
    expect(result.current.timedOut).toBe(true);
  });

  it('does nothing when inactive', async () => {
    const spy = vi.spyOn(api, 'listFlows');
    const { result } = renderHook(() => useFlowArrival(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.waiting).toBe(false);
  });

  it('keeps polling through a transient failure', async () => {
    const spy = vi
      .spyOn(api, 'listFlows')
      .mockResolvedValueOnce(page([]))
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(page(['f1']));

    const { result } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current.waiting).toBe(false);
  });

  it('stops polling when unmounted', async () => {
    const spy = vi.spyOn(api, 'listFlows').mockResolvedValue(page([]));

    const { unmount } = renderHook(() => useFlowArrival(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    const callsBefore = spy.mock.calls.length;

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    // A timer left running after navigation would keep hitting the API for the
    // rest of the session.
    expect(spy.mock.calls.length).toBe(callsBefore);
  });
});
