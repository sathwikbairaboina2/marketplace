'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, Card, Descriptions, Form, InputNumber, Spin, message } from 'antd';
import type { EventResponse } from '@marketplace/contracts';
import { getEvent } from '../../../../lib/api/events';
import { createBooking } from '../../../../lib/api/bookings';
import { toAttributes, toDescriptionRows, toFormItems } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { ProblemError } from '../../../../lib/api/http';
import { notifyProblem } from '../../../../lib/problem-notify';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const eventSchema = useSchema('Event');
  const bookingSchema = useSchema('Booking');
  const [event, setEvent] = useState<EventResponse | null>(null);
  const [busy, setBusy] = useState(false);

  // Minted when the intent forms -- on mount -- not on click, so every retry
  // reuses it and the engine replays instead of double-booking.
  const idempotencyKey = useRef<string>('');
  if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();

  useEffect(() => {
    getEvent(id).then(setEvent).catch(notifyProblem);
  }, [id]);

  if (!event) return <Spin />;

  const remaining = event.capacity - event.bookedCount;

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      const body = {
        eventId: event.id,
        ticketQuantity: values.ticketQuantity as number,
        attributes: toAttributes(
          bookingSchema?.fields ?? {},
          (values.attributes ?? {}) as Record<string, unknown>,
        ),
      };

      for (let attempt = 0; ; attempt++) {
        try {
          const booking = await createBooking(body, idempotencyKey.current);
          void message.success('Booked');
          router.push(`/bookings/${booking.id}`);
          return;
        } catch (err) {
          const inProgress = err instanceof ProblemError && err.status === 409;
          if (!inProgress || attempt >= BACKOFFS_MS.length - 1) throw err;
          await sleep(BACKOFFS_MS[attempt]!);
        }
      }
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={event.title}>
      <Descriptions
        column={1}
        items={[
          { key: 'start', label: 'Starts', children: event.startDate },
          { key: 'end', label: 'Ends', children: event.endDate },
          { key: 'capacity', label: 'Capacity', children: event.capacity },
          { key: 'booked', label: 'Booked', children: event.bookedCount },
          {
            key: 'price',
            label: 'Price',
            children: `${(event.basePriceMinor / 100).toFixed(2)} ${event.currency}`,
          },
          ...(eventSchema ? toDescriptionRows(eventSchema.fields, event.attributes) : []),
        ]}
      />
      <Form
        layout="vertical"
        onFinish={submit}
        initialValues={{ ticketQuantity: 1 }}
        style={{ marginTop: 24 }}
      >
        {/* CreateBookingSchema caps ticketQuantity at 100; capacity is enforced
            transactionally server-side, so this bound is a courtesy, not the
            guarantee. */}
        <Form.Item name="ticketQuantity" label="Tickets" rules={[{ required: true }]}>
          <InputNumber min={1} max={Math.min(100, Math.max(remaining, 1))} />
        </Form.Item>
        {bookingSchema ? toFormItems(bookingSchema.fields) : null}
        <Button type="primary" htmlType="submit" loading={busy} disabled={busy || remaining < 1}>
          {remaining < 1 ? 'Sold out' : 'Book'}
        </Button>
      </Form>
    </Card>
  );
}
