'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { useShopReads } from '../../../lib/shop/reads';
import { formatDateTime, formatMoney } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';
import { EmptyState } from '../../../components/empty-state';
import { PageHeader } from '../../../components/page-header';

export default function EventsPage() {
  const reads = useShopReads();
  return (
    <>
      <PageHeader title="Events" subtitle="Sessions you can book a place at." />
      <div className="mp-list-measure">
      <CursorTable<EventResponse>
          rowKey="id"
          caption="Scheduled events"
          noun={{ one: 'event', many: 'events' }}
          load={(cursor) => reads.listEvents(25, cursor)}
          empty={
            <EmptyState
              title="Nothing scheduled"
              description="No events on sale yet. The shop's products are still open."
              action={
                <Link href="/products">
                  <Button type="primary">Browse products</Button>
                </Link>
              }
            />
          }
          columns={[
            {
              title: 'Title',
              dataIndex: 'title',
              render: (title: string, row) => <Link href={`/events/${row.id}`}>{title}</Link>,
            },
            {
              title: 'Starts',
              dataIndex: 'startDate',
              render: (at: string) => formatDateTime(at),
            },
            {
              title: 'Booked',
              // `bookedCount`, not `booked` -- EventRecord and ProductRecord are
              // not symmetrical.
              dataIndex: 'bookedCount',
              className: 'mp-num',
              align: 'right' as const,
              // One fact, one column: how full the session is.
              render: (booked: number, row) => `${booked} of ${row.capacity}`,
            },
            {
              title: 'Price',
              dataIndex: 'basePriceMinor',
              className: 'mp-num',
              align: 'right' as const,
              render: (minor: number, row) => `${formatMoney(minor, row.currency)} ${row.currency}`,
            },
          ]}
        />
      </div>
    </>
  );
}
