import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CursorTable } from './cursor-table';
import { ProblemError } from '../lib/api/http';

interface Row {
  id: string;
  name: string;
}

const COLUMNS = [{ title: 'Name', dataIndex: 'name' }];
const EMPTY = <p>Nothing to show</p>;

function renderTable(
  load: (cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>,
  reloadToken?: unknown,
) {
  return render(
    <CursorTable<Row>
      rowKey="id"
      columns={COLUMNS}
      load={load}
      empty={EMPTY}
      caption="Rows"
      reloadToken={reloadToken}
    />,
  );
}

describe('CursorTable', () => {
  it('appends the next page and hides Load more when the cursor runs out', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [{ id: 'b', name: 'B' }], nextCursor: null });

    renderTable(load);

    await act(async () => {});
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).toBeNull();

    await act(async () => {
      screen.getByText('Load more').click();
    });

    // Pages accumulate rather than replace -- the API returns no total, so
    // there is no page number to go back to.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.queryByText('Load more')).toBeNull();
    expect(load).toHaveBeenNthCalledWith(2, 'c1');
  });

  it('shows no Load more when the first page is already the last', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValue({ items: [{ id: 'a', name: 'A' }], nextCursor: null });

    renderTable(load);
    await act(async () => {});

    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('discards accumulated pages when reloadToken changes', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'z', name: 'Z' }], nextCursor: null });

    const { rerender } = renderTable(load, 0);
    await act(async () => {});
    expect(screen.getByText('A')).toBeInTheDocument();

    rerender(
      <CursorTable<Row>
        rowKey="id"
        columns={COLUMNS}
        load={load}
        empty={EMPTY}
        caption="Rows"
        reloadToken={1}
      />,
    );
    await act(async () => {});

    // Applying a filter must not leave the previous result set stitched on top.
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('Z')).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith(null);
  });

  it('renders no table at all when there are no rows', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValue({ items: [], nextCursor: null });

    const { container } = renderTable(load);
    await act(async () => {});

    // The column headings must go with the rows. Rendering the empty state
    // through ANTD's `locale.emptyText` left `/orders` showing ORDER STATUS
    // ITEMS TOTAL PLACED above a slab reading "Nothing here yet".
    expect(container.querySelector('table')).toBeNull();
    expect(screen.queryByText('Name')).toBeNull();
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  it('replaces the table with a retryable error when the first page fails', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockRejectedValueOnce(
        new ProblemError('about:blank', 500, 'Upstream failed', 'DynamoDB timed out', 'trace-1', []),
      )
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: null });

    const { container } = renderTable(load);
    await act(async () => {});

    // A failed fetch must not claim the collection is empty.
    expect(screen.queryByText('Nothing to show')).toBeNull();
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('Upstream failed')).toBeInTheDocument();
    expect(screen.getByText('DynamoDB timed out')).toBeInTheDocument();
    expect(screen.getByText('trace: trace-1')).toBeInTheDocument();

    await act(async () => {
      screen.getByText('Try again').click();
    });

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('Upstream failed')).toBeNull();
  });
});
