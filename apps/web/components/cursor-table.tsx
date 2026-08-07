'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { notifyProblem } from '../lib/problem-notify';

interface Props<T> {
  columns: ColumnsType<T>;
  rowKey: string;
  load: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Change this to discard the accumulated pages and reload from the start. */
  reloadToken?: unknown;
}

/**
 * The API pages by opaque cursor and returns no total, so ANTD's built-in
 * pagination -- which needs one to compute page numbers -- cannot be used.
 * Pages accumulate behind a "Load more" button instead, and stay in memory so
 * back-navigation does not lose them.
 */
export function CursorTable<T extends object>({ columns, rowKey, load, reloadToken }: Props<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(
    async (from: string | null, append: boolean) => {
      setLoading(true);
      try {
        const page = await load(from);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (err) {
        notifyProblem(err);
      } finally {
        setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    // Reset before refetching: a changed filter must not leave the previous
    // result set stitched on top of the new one.
    setItems([]);
    setDone(false);
    void fetchPage(null, false);
  }, [fetchPage, reloadToken]);

  return (
    <>
      <Table<T>
        rowKey={rowKey}
        columns={columns}
        dataSource={items}
        pagination={false}
        loading={loading}
      />
      {!done && (
        <Button
          style={{ marginTop: 16 }}
          loading={loading}
          onClick={() => void fetchPage(cursor, true)}
        >
          Load more
        </Button>
      )}
    </>
  );
}
