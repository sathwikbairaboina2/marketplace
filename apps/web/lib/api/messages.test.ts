import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { MessageResponse } from '@marketplace/contracts';

const request = vi.fn();
vi.mock('./http', () => ({ request: (path: string, opts: unknown) => request(path, opts) }));

import { listWholeThread } from './messages';

const message = (id: string): MessageResponse => ({
  entityType: 'Message',
  id,
  orderId: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  stageId: 'st-1',
  authorUserId: 'u1',
  authorRole: 'buyer',
  body: id,
  createdAt: '2026-08-18T10:00:00.000Z',
});

const page = (ids: string[], nextCursor: string | null) => ({
  items: ids.map(message),
  nextCursor,
});

beforeEach(() => request.mockReset());

describe('listWholeThread', () => {
  it('returns a short thread in one read', async () => {
    request.mockResolvedValueOnce(page(['a', 'b'], null));

    const thread = await listWholeThread('ord-1');
    expect(thread.items.map((m) => m.id)).toEqual(['a', 'b']);
    expect(thread.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  // The engine returns a thread oldest first and caps a page at 100. Reading
  // only page one showed the oldest hundred messages and silently dropped the
  // newest -- the ones anybody actually wants.
  it('follows the cursor so the newest messages are not dropped', async () => {
    request
      .mockResolvedValueOnce(page(['old-1', 'old-2'], 'cursor-1'))
      .mockResolvedValueOnce(page(['new-1'], null));

    const thread = await listWholeThread('ord-1');
    expect(thread.items.map((m) => m.id)).toEqual(['old-1', 'old-2', 'new-1']);
    expect(thread.truncated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('passes the cursor it was given back to the engine', async () => {
    request
      .mockResolvedValueOnce(page(['a'], 'cursor-1'))
      .mockResolvedValueOnce(page(['b'], null));

    await listWholeThread('ord-1');
    expect(request.mock.calls[1][1]).toMatchObject({ query: { cursor: 'cursor-1' } });
  });

  it('stops at its budget and says so rather than fetching forever', async () => {
    // A cursor that never runs out: without a budget this would not return.
    request.mockResolvedValue(page(['x'], 'always-more'));

    const thread = await listWholeThread('ord-1');
    expect(thread.truncated).toBe(true);
    expect(request).toHaveBeenCalledTimes(10);
  });
});
