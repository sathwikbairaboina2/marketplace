'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { MailMessage } from '@marketplace/contracts';
import { listNotifications } from '../../../../lib/api/notifications';
import { formatRelative } from '../../../../lib/format';
import { CursorTable } from '../../../../components/cursor-table';
import { EmptyState } from '../../../../components/empty-state';
import { PageHeader } from '../../../../components/page-header';

const KIND_LABELS: Record<string, string> = {
  'order-confirmation': 'Order confirmed',
  'booking-confirmation': 'Class booked',
  'back-in-stock': 'Back in stock',
};

/**
 * What the shop has said to customers. It exists so the merchant can answer
 * the question she will actually be asked -- "I never got anything" -- without
 * having to trust that a send happened.
 */
export default function AdminOutboxPage() {
  return (
    <>
      <PageHeader
        title="Sent messages"
        subtitle="Everything your shop has emailed a customer, newest first."
      />
      <div className="mp-list-measure">
        <CursorTable<MailMessage>
          rowKey="id"
          caption="Sent messages"
          noun={{ one: 'message', many: 'messages' }}
          load={(cursor) => listNotifications(25, cursor)}
          search={{
            placeholder: 'Find a message by address or order number',
            matches: (row, q) => {
              const needle = q.toLowerCase();
              return (
                row.to.toLowerCase().includes(needle) ||
                (row.about ?? '').toLowerCase().includes(needle) ||
                row.subject.toLowerCase().includes(needle)
              );
            },
          }}
          empty={
            <EmptyState
              title="Nothing sent yet"
              description="When a customer orders or books a class, the message your shop sends them appears here."
              action={
                <Link href="/admin/orders">
                  <Button>Your orders</Button>
                </Link>
              }
            />
          }
          columns={[
            { title: 'Sent', dataIndex: 'sentAt', render: (at: string) => formatRelative(at) },
            {
              title: 'What',
              dataIndex: 'kind',
              render: (kind: string) => KIND_LABELS[kind] ?? kind,
            },
            { title: 'To', dataIndex: 'to' },
            { title: 'About', dataIndex: 'about', render: (about?: string) => about ?? '—' },
          ]}
        />
      </div>
    </>
  );
}
