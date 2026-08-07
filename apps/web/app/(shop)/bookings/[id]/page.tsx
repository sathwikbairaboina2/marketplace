'use client';

import { useParams } from 'next/navigation';
import { Card, Descriptions } from 'antd';
import type { BookingResponse } from '@marketplace/contracts';
import { getBooking } from '../../../../lib/api/bookings';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../lib/use-resource';
import { StatusTag } from '../../../../components/status-tag';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';
import { formatDateTime } from '../../../../lib/format';

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Booking');
  const {
    data: booking,
    error,
    loading,
    retry,
  } = useResource<BookingResponse>(() => getBooking(id), [id]);

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!booking) return null;

  return (
    <Card title={`Booking ${booking.id}`}>
      <Descriptions
        column={1}
        items={[
          { key: 'event', label: 'Event', children: booking.eventId },
          { key: 'status', label: 'Status', children: <StatusTag status={booking.status} /> },
          { key: 'tickets', label: 'Tickets', children: booking.ticketQuantity },
          { key: 'booked', label: 'Booked', children: formatDateTime(booking.createdAt) },
          ...(schema ? toDescriptionRows(schema.fields, booking.attributes) : []),
        ]}
      />
    </Card>
  );
}
