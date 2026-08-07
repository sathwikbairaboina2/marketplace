'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { listEvents } from '../../../../lib/api/events';
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
          { title: 'Starts', dataIndex: 'startDate' },
          { title: 'Ends', dataIndex: 'endDate' },
          { title: 'Capacity', dataIndex: 'capacity' },
          // `bookedCount`, not `booked` -- EventRecord and ProductRecord are
          // not symmetrical.
          {
            title: 'Booked',
            dataIndex: 'bookedCount',
            render: (booked: number, row) => `${booked} / ${row.capacity}`,
          },
          {
            title: 'Price',
            dataIndex: 'basePriceMinor',
            render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
          },
        ]}
      />
    </>
  );
}
