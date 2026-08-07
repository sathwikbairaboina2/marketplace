'use client';

import Link from 'next/link';
import type { EventResponse } from '@marketplace/contracts';
import { listEvents } from '../../lib/api/events';
import { CursorTable } from '../../components/cursor-table';

export default function EventsPage() {
  return (
    <CursorTable<EventResponse>
      rowKey="id"
      load={(cursor) => listEvents(25, cursor)}
      columns={[
        {
          title: 'Title',
          dataIndex: 'title',
          render: (title: string, row) => <Link href={`/events/${row.id}`}>{title}</Link>,
        },
        { title: 'Starts', dataIndex: 'startDate' },
        { title: 'Capacity', dataIndex: 'capacity' },
        // `bookedCount`, not `booked` -- EventRecord and ProductRecord are not
        // symmetrical.
        { title: 'Booked', dataIndex: 'bookedCount' },
        {
          title: 'Price',
          dataIndex: 'basePriceMinor',
          render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
        },
      ]}
    />
  );
}
