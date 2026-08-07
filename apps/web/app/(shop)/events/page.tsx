'use client';

import Link from 'next/link';
import type { EventResponse } from '@marketplace/contracts';
import { listEvents } from '../../../lib/api/events';
import { formatDateTime, formatMoney } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';

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
        {
          title: 'Starts',
          dataIndex: 'startDate',
          render: (at: string) => formatDateTime(at),
        },
        { title: 'Capacity', dataIndex: 'capacity', className: 'mp-num' },
        // `bookedCount`, not `booked` -- EventRecord and ProductRecord are not
        // symmetrical.
        { title: 'Booked', dataIndex: 'bookedCount', className: 'mp-num' },
        {
          title: 'Price',
          dataIndex: 'basePriceMinor',
          className: 'mp-num',
          render: (minor: number, row) => `${formatMoney(minor)} ${row.currency}`,
        },
      ]}
    />
  );
}
