'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { BookingResponse } from '@marketplace/contracts';
import { listBookings } from '../../../lib/api/bookings';
import { formatRelative } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusTag } from '../../../components/status-tag';
import { PageHeader } from '../../../components/page-header';
import { Ref } from '../../../components/ref';
import { EventName } from '../../../components/record-name';

export default function BookingsPage() {
  return (
    <>
      <PageHeader title="Bookings" subtitle="Places you have reserved." />
      <div className="mp-list-measure">
      <CursorTable<BookingResponse>
          rowKey="id"
          caption="Your bookings"
          noun={{ one: 'booking', many: 'bookings' }}
          load={(cursor) => listBookings(25, cursor)}
          empty={
            <EmptyState
              title="No bookings yet"
              description="Tickets you book for an event appear here."
              action={
                <Link href="/events">
                  <Button type="primary">Browse events</Button>
                </Link>
              }
            />
          }
          columns={[
            {
              title: 'Booked',
              dataIndex: 'createdAt',
              render: (at: string, row) => (
                <Link href={`/bookings/${row.id}`}>{formatRelative(at)}</Link>
              ),
            },
            {
              // Which event, in the words it was booked under. A row that says
              // only "2 tickets, 4 days ago" tells the holder nothing.
              title: 'Event',
              dataIndex: 'eventId',
              render: (eventId: string) => <EventName id={eventId} href={`/events/${eventId}`} />,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (status: string) => <StatusTag status={status} />,
            },
            {
              title: 'Tickets',
              dataIndex: 'ticketQuantity',
              className: 'mp-num',
              align: 'right' as const,
            },
            // No Event column. It held a second full ULID that named nothing, and
            // a row identifies one thing, not two -- the detail page resolves the
            // event's title and is one click away.
            {
              title: 'Ref',
              dataIndex: 'id',
              render: (id: string) => <Ref value={id} />,
            },
          ]}
        />
      </div>
    </>
  );
}
