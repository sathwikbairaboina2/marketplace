'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, Input, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { notifyProblem } from '../lib/problem-notify';
import { ErrorPanel } from './error-panel';
import { TableSkeleton } from './skeletons';

interface Props<T> {
  columns: ColumnsType<T>;
  rowKey: string;
  load: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>;
  /** Change this to discard the accumulated pages and reload from the start. */
  reloadToken?: unknown;
  /** Shown, in place of the whole table, when the tenant has nothing at all. */
  empty: ReactNode;
  /** Visually hidden; names the table for a screen reader. */
  caption: string;
  /**
   * Names the rows in the end-of-list line. Required rather than defaulted to
   * "item": a default is how a page about bookings ends up saying "5 items".
   */
  noun: { one: string; many: string };
  /**
   * Optional filter over the rows already loaded. Client-side on purpose: the
   * merchant's real question is "which of these is Priya" over a queue she can
   * see, and the engine has no search access pattern for orders or bookings --
   * adding one is an index, not a text box. "Load more" first, then filter, and
   * the count says which it is showing.
   */
  search?: { placeholder: string; matches: (row: T, query: string) => boolean };
}

/**
 * The API pages by opaque cursor and returns no total, so ANTD's built-in
 * pagination -- which needs one to compute page numbers -- cannot be used.
 * Pages accumulate behind a "Load more" button instead, and stay in memory so
 * back-navigation does not lose them.
 */
export function CursorTable<T extends object>({
  columns,
  rowKey,
  load,
  reloadToken,
  empty,
  caption,
  noun,
  search,
}: Props<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [query, setQuery] = useState('');

  const fetchPage = useCallback(
    async (from: string | null, append: boolean) => {
      setLoading(true);
      try {
        const page = await load(from);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
        setError(null);
      } catch (err) {
        // Keep the accumulated rows on a failed *subsequent* page: losing four
        // pages of results because the fifth timed out is worse than the error.
        // The panel replaces the table only when there is nothing to preserve.
        setError(err);
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
    setError(null);
    void fetchPage(null, false);
  }, [fetchPage, reloadToken]);

  const retry = () => void fetchPage(null, false);

  if (loading && items.length === 0) {
    return <TableSkeleton columns={columns.length} />;
  }

  // Both of these replace the table outright rather than filling its body.
  // ANTD's `locale.emptyText` renders *inside* the table, which left `/orders`
  // drawing `ORDER STATUS ITEMS TOTAL PLACED` above the words "Nothing here
  // yet" -- column headings for columns that hold nothing.
  if (error && items.length === 0) {
    return <ErrorPanel error={error} onRetry={retry} />;
  }

  if (items.length === 0) {
    return <>{empty}</>;
  }

  const trimmed = query.trim();
  const rows = trimmed && search ? items.filter((row) => search.matches(row, trimmed)) : items;

  return (
    <>
      {search && (
        <Input.Search
          allowClear
          placeholder={search.placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onSearch={setQuery}
          style={{ maxWidth: 380, marginBottom: 'var(--mp-space-5)' }}
        />
      )}
      {trimmed && rows.length === 0 && (
        <p className="mp-muted-line">
          Nothing here matches “{trimmed}”. Load more below if the {noun.one} is older.
        </p>
      )}
      {error && <ErrorPanel error={error} onRetry={() => void fetchPage(cursor, true)} />}
      <Table<T>
        rowKey={rowKey}
        columns={columns}
        dataSource={rows}
        pagination={false}
        loading={loading}
        scroll={{ x: 'max-content' }}
        caption={<span className="mp-visually-hidden">{caption}</span>}
      />
      {!done ? (
        <Button
          style={{ marginTop: 'var(--mp-space-5)' }}
          loading={loading}
          onClick={() => void fetchPage(cursor, true)}
        >
          Load more
        </Button>
      ) : (
        // A list that has ended should say so. Rendering nothing here left the
        // last page indistinguishable from one still loading, and both trailed
        // off into blank page.
        <p className="mp-list-end">
          {items.length} {items.length === 1 ? noun.one : noun.many} · end of list
        </p>
      )}
    </>
  );
}
