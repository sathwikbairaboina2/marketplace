'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { BookingResponse } from '@marketplace/contracts';
import { listAllBookings } from '../../../../lib/api/bookings';
import { formatRelative } from '../../../../lib/format';
import { CursorTable } from '../../../../components/cursor-table';
import { EmptyState } from '../../../../components/empty-state';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';
import { Ref } from '../../../../components/ref';
import { EventName } from '../../../../components/record-name';

/**
 * The seller's attendance list: every booking the shop has taken, not the
 * signed-in admin's own. Until this page existed the cockpit's Bookings entry
 * opened the shopper's page, which for an owner who never books is empty.
 */
export default function AdminBookingsPage() {
  return (
    <>
      <PageHeader title="Bookings" subtitle="Every place reserved at your events." />
      <div className="mp-list-measure">
        <CursorTable<BookingResponse>
          rowKey="id"
          caption="Shop bookings"
          noun={{ one: 'booking', many: 'bookings' }}
          load={(cursor) => listAllBookings(25, cursor)}
          empty={
            <EmptyState
              title="No bookings yet"
              description="Tickets your customers book appear here, newest first."
              action={
                <Link href="/admin/events">
                  <Button>Your events</Button>
                </Link>
              }
            />
          }
          columns={[
            {
              title: 'Booked',
              dataIndex: 'createdAt',
              render: (at: string) => formatRelative(at),
            },
            {
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
