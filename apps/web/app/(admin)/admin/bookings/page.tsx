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
          search={{
            placeholder: 'Find someone by name, phone, email or reference',
            matches: (row, q) => {
              const needle = q.toLowerCase();
              const digits = q.replace(/\D/g, '');
              return (
                (row.attendeeName ?? '').toLowerCase().includes(needle) ||
                (row.guestEmail ?? '').toLowerCase().includes(needle) ||
                (row.reference ?? '').toLowerCase().includes(needle) ||
                // A phone number is written a dozen ways; compare the digits.
                (digits.length >= 4 &&
                  (row.attendeePhone ?? '').replace(/\D/g, '').includes(digits))
              );
            },
          }}
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
              // The register. A class is six people in a room, and this table
              // showed a reference code and no way to reach anybody: on the
              // Saturday morning the merchant could not ring the person who
              // had not arrived, or tell the group their bowls were fired.
              title: 'Who is coming',
              dataIndex: 'attendeeName',
              render: (name: string | undefined, row) => (
                <div className="mp-stack-tight">
                  <span>{name ?? '—'}</span>
                  {row.attendeePhone && (
                    <a href={`tel:${row.attendeePhone.replace(/[^\d+]/g, '')}`} className="mp-sub">
                      {row.attendeePhone}
                    </a>
                  )}
                  {row.guestEmail && <span className="mp-sub">{row.guestEmail}</span>}
                </div>
              ),
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
              dataIndex: 'reference',
              render: (reference: string) => <Ref value={reference} />,
            },
          ]}
        />
      </div>
    </>
  );
}
