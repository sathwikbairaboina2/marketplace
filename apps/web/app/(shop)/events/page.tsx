'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { useShopReads } from '../../../lib/shop/reads';
import { notifyProblem } from '../../../lib/problem-notify';
import { EventCard } from '../../../components/event-card';
import { EmptyState } from '../../../components/empty-state';
import { ErrorPanel } from '../../../components/error-panel';
import { GridSkeleton } from '../../../components/skeletons';
import { PageHeader } from '../../../components/page-header';

const PAGE = 24;

/**
 * The shop's classes. Cards, not the table this was: at 390px the table put
 * the price and every action off the right edge behind a horizontal scroll
 * with nothing to say so, and it published "22 of 24 places left" — scarcity
 * read backwards on the highest-margin line in the shop.
 */
export default function EventsPage() {
  const reads = useShopReads();
  const [items, setItems] = useState<EventResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchPage = useCallback(
    async (from: string | null, append: boolean) => {
      setLoading(true);
      try {
        const page = await reads.listEvents(PAGE, from);
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
        setError(null);
      } catch (err) {
        setError(err);
        notifyProblem(err);
      } finally {
        setLoading(false);
      }
    },
    [reads],
  );

  useEffect(() => {
    void fetchPage(null, false);
  }, [fetchPage]);

  return (
    <>
      <PageHeader title="Classes and events" subtitle="Sessions you can book a place at." />

      {error && items.length === 0 ? (
        <ErrorPanel error={error} onRetry={() => void fetchPage(null, false)} />
      ) : loading && items.length === 0 ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description="No classes on sale yet. The shop's products are still open."
          action={
            <Link href="/products">
              <Button type="primary">Browse products</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="mp-grid">
            {items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
          {!done && (
            <Button
              style={{ marginTop: 'var(--mp-space-6)' }}
              loading={loading}
              onClick={() => void fetchPage(cursor, true)}
            >
              Load more
            </Button>
          )}
        </>
      )}
    </>
  );
}
