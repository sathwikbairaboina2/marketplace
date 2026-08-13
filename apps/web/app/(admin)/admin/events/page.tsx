'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { listEvents } from '../../../../lib/api/events';
import { formatDateTime, formatMoney } from '../../../../lib/format';
import { CursorTable } from '../../../../components/cursor-table';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';

export default function AdminEventsPage() {
  return (
    <>
      <PageHeader
        title="Events"
        subtitle="Scheduled events and how full they are"
        extra={
          <Link href="/admin/events/new">
            <Button type="primary">New event</Button>
          </Link>
        }
      />

      <CursorTable<EventResponse>
        rowKey="id"
        caption="Scheduled events and their capacity"
        noun={{ one: 'event', many: 'events' }}
        load={(cursor) => listEvents(25, cursor)}
        empty={
          <EmptyState
            title="No events yet"
            description="Create one to start taking bookings."
            action={
              <Link href="/admin/events/new">
                <Button type="primary">New event</Button>
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
            title: 'Ends',
            dataIndex: 'endDate',
            render: (at: string) => formatDateTime(at),
          },
          // `bookedCount`, not `booked` -- EventRecord and ProductRecord are
          // not symmetrical.
          {
            title: 'Booked',
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
            render: (minor: number, row) => `${formatMoney(minor)} ${row.currency}`,
          },
        ]}
      />
    </>
  );
}
