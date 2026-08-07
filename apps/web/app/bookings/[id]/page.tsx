'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Spin } from 'antd';
import type { BookingResponse } from '@marketplace/contracts';
import { getBooking } from '../../../lib/api/bookings';
import { toDescriptionRows } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../lib/problem-notify';

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Booking');
  const [booking, setBooking] = useState<BookingResponse | null>(null);

  useEffect(() => {
    getBooking(id).then(setBooking).catch(notifyProblem);
  }, [id]);

  if (!booking) return <Spin />;

  return (
    <Card title={`Booking ${booking.id}`}>
      <Descriptions
        column={1}
        items={[
          { key: 'event', label: 'Event', children: booking.eventId },
          { key: 'status', label: 'Status', children: booking.status },
          { key: 'tickets', label: 'Tickets', children: booking.ticketQuantity },
          { key: 'booked', label: 'Booked', children: booking.createdAt },
          ...(schema ? toDescriptionRows(schema.fields, booking.attributes) : []),
        ]}
      />
    </Card>
  );
}
