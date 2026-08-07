'use client';

import Link from 'next/link';
import type { BookingResponse } from '@marketplace/contracts';
import { listBookings } from '../../lib/api/bookings';
import { CursorTable } from '../../components/cursor-table';

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
        { title: 'Status', dataIndex: 'status' },
        { title: 'Tickets', dataIndex: 'ticketQuantity' },
        { title: 'Booked', dataIndex: 'createdAt' },
      ]}
    />
  );
}
