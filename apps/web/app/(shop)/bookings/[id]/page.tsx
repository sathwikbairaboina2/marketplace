'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, Descriptions } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { BookingResponse, EventResponse } from '@marketplace/contracts';
import { getBooking } from '../../../../lib/api/bookings';
import { getEvent } from '../../../../lib/api/events';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../lib/use-resource';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';
import { Ref } from '../../../../components/ref';
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

  // Declared above the early returns: a hook cannot live after a conditional
  // `return`. Resolving one referenced record on a single-record page is a
  // different cost from resolving names across a whole list, which is why
  // /bookings does not do this.
  const eventId = booking?.eventId ?? null;
  const { data: event } = useResource<EventResponse | null>(
    () => (eventId ? getEvent(eventId) : Promise.resolve(null)),
    [eventId],
  );

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!booking) return null;

  return (
    <>
      <Link href="/bookings" className="mp-back">
        <ArrowLeftOutlined /> All bookings
      </Link>

      {/* The id was the page title. It is a reference, not a name, so it moves
          into the record and the status leads instead. */}
      <PageHeader
        title="Booking"
        subtitle={`Booked ${formatDateTime(booking.createdAt)}`}
        extra={<StatusTag status={booking.status} />}
      />

      <Card className="mp-record">
        <Descriptions
          column={1}
          items={[
            {
              key: 'event',
              label: 'Event',
              // The booking payload carries an id and no title, so the title is
              // fetched. If that fails the reference still links through --
              // degraded, not broken.
              children: event ? (
                <Link href={`/events/${booking.eventId}`}>{event.title}</Link>
              ) : (
                <Ref value={booking.eventId} href={`/events/${booking.eventId}`} />
              ),
            },
            { key: 'tickets', label: 'Tickets', children: booking.ticketQuantity },
            {
              key: 'reference',
              label: 'Reference',
              children: <code className="mp-id">{booking.id}</code>,
            },
            ...(schema ? toDescriptionRows(schema.fields, booking.attributes) : []),
          ]}
        />
      </Card>
    </>
  );
}
