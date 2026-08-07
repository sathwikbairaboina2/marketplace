'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, Descriptions, Form, InputNumber, Progress, Skeleton, message } from 'antd';
import { ArrowLeftOutlined, CalendarOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { EventResponse } from '@marketplace/contracts';
import { getEvent } from '../../../../lib/api/events';
import { createBooking } from '../../../../lib/api/bookings';
import { toAttributes, toDescriptionRows, toFormItems } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { ProblemError } from '../../../../lib/api/http';
import { notifyProblem } from '../../../../lib/problem-notify';
import { formatDateTime, formatMoney } from '../../../../lib/format';

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

  if (!event) return <Skeleton active paragraph={{ rows: 6 }} />;

  const remaining = event.capacity - event.bookedCount;
  const soldOut = remaining < 1;
  const pctFull = Math.round((event.bookedCount / Math.max(event.capacity, 1)) * 100);
  const attributeRows = eventSchema
    ? toDescriptionRows(eventSchema.fields, event.attributes)
    : [];

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
    <>
      <Link href="/events" className="mp-back">
        <ArrowLeftOutlined /> All events
      </Link>

      <div className="mp-detail">
        <div className="mp-detail-buy" style={{ order: 2 }}>
          <h2 style={{ marginBottom: 'var(--mp-space-4)' }}>Book tickets</h2>
          <div className="mp-detail-price">
            {event.basePriceMinor === 0 ? 'Free' : formatMoney(event.basePriceMinor)}
            {event.basePriceMinor > 0 && <span className="cur">{event.currency}</span>}
          </div>

          <div className="mp-capacity">
            <Progress
              percent={pctFull}
              showInfo={false}
              strokeColor="var(--mp-primary)"
              size="small"
            />
            <span className="mp-card-stock" data-low={remaining <= 5 || undefined}>
              {soldOut
                ? 'Sold out'
                : `${remaining} of ${event.capacity} place${event.capacity === 1 ? '' : 's'} left`}
            </span>
          </div>

          <Form layout="vertical" onFinish={submit} initialValues={{ ticketQuantity: 1 }}>
            {/* CreateBookingSchema caps ticketQuantity at 100; capacity is
                enforced transactionally server-side, so this bound is a
                courtesy, not the guarantee. */}
            <Form.Item name="ticketQuantity" label="Tickets" rules={[{ required: true }]}>
              <InputNumber
                min={1}
                max={Math.min(100, Math.max(remaining, 1))}
                disabled={soldOut}
                style={{ width: '100%' }}
              />
            </Form.Item>
            {bookingSchema ? toFormItems(bookingSchema.fields) : null}
            <Button
              type="primary"
              size="large"
              block
              htmlType="submit"
              loading={busy}
              disabled={busy || soldOut}
            >
              {soldOut ? 'Sold out' : 'Book'}
            </Button>
          </Form>
        </div>

        <div className="mp-detail-media" style={{ order: 1, background: 'transparent' }}>
          <div className="mp-event-head">
            <h1>{event.title}</h1>
            <div className="mp-event-facts">
              <span>
                <CalendarOutlined /> {formatDateTime(event.startDate)}
              </span>
              <span>
                <EnvironmentOutlined /> ends {formatDateTime(event.endDate)}
              </span>
            </div>

            {attributeRows.length > 0 && (
              <div className="mp-detail-specs">
                <h2>Details</h2>
                <Descriptions column={1} size="small" items={attributeRows} />
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
