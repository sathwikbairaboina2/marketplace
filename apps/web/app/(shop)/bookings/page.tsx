'use client';

import Link from 'next/link';
import type { BookingResponse } from '@marketplace/contracts';
import { listBookings } from '../../../lib/api/bookings';
import { formatRelative } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';
import { StatusTag } from '../../../components/status-tag';

export default function BookingsPage() {
  return (
    <CursorTable<BookingResponse>
      rowKey="id"
      load={(cursor) => listBookings(25, cursor)}
      columns={[
        {
          title: 'Booking',
          dataIndex: 'id',
          render: (id: string) => <Link href={`/bookings/${id}`}>{id}</Link>,
        },
        {
          title: 'Event',
          dataIndex: 'eventId',
          render: (eventId: string) => <Link href={`/events/${eventId}`}>{eventId}</Link>,
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (status: string) => <StatusTag status={status} />,
        },
        { title: 'Tickets', dataIndex: 'ticketQuantity', className: 'mp-num' },
        {
          title: 'Booked',
          dataIndex: 'createdAt',
          render: (at: string) => formatRelative(at),
        },
      ]}
    />
  );
}
