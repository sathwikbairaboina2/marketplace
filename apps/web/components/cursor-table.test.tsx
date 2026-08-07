import { describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CursorTable } from './cursor-table';

interface Row {
  id: string;
  name: string;
}

describe('CursorTable', () => {
  it('appends the next page and hides Load more when the cursor runs out', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [{ id: 'b', name: 'B' }], nextCursor: null });

    render(
      <CursorTable<Row> rowKey="id" columns={[{ title: 'Name', dataIndex: 'name' }]} load={load} />,
    );

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

    render(
      <CursorTable<Row> rowKey="id" columns={[{ title: 'Name', dataIndex: 'name' }]} load={load} />,
    );
    await act(async () => {});

    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('discards accumulated pages when reloadToken changes', async () => {
    const load = vi
      .fn<(cursor: string | null) => Promise<{ items: Row[]; nextCursor: string | null }>>()
      .mockResolvedValueOnce({ items: [{ id: 'a', name: 'A' }], nextCursor: null })
      .mockResolvedValueOnce({ items: [{ id: 'z', name: 'Z' }], nextCursor: null });

    const { rerender } = render(
      <CursorTable<Row>
        rowKey="id"
        columns={[{ title: 'Name', dataIndex: 'name' }]}
        load={load}
        reloadToken={0}
      />,
    );
    await act(async () => {});
    expect(screen.getByText('A')).toBeInTheDocument();

    rerender(
      <CursorTable<Row>
        rowKey="id"
        columns={[{ title: 'Name', dataIndex: 'name' }]}
        load={load}
        reloadToken={1}
      />,
    );
    await act(async () => {});

    // Applying a filter must not leave the previous result set stitched on top.
    expect(screen.queryByText('A')).toBeNull();
    expect(screen.getByText('Z')).toBeInTheDocument();
    expect(load).toHaveBeenLastCalledWith(null);
  });
});
