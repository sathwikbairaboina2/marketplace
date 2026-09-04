'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { listAllOrders } from '../../../../lib/api/orders';
import { formatPrice, formatRelative } from '../../../../lib/format';
import { CursorTable } from '../../../../components/cursor-table';
import { EmptyState } from '../../../../components/empty-state';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';
import { Ref } from '../../../../components/ref';

/**
 * The seller's queue: every order in the shop, not the signed-in admin's own.
 * The stage column is what makes it a queue rather than a ledger -- it says what
 * needs doing next.
 */
export default function AdminOrdersPage() {
  return (
    <>
      <PageHeader title="Orders" subtitle="Everything your shop has taken, and where each one is." />
      <div className="mp-list-measure">
        <CursorTable<OrderResponse>
          rowKey="id"
          caption="Shop orders"
          noun={{ one: 'order', many: 'orders' }}
          load={(cursor) => listAllOrders(25, cursor)}
          search={{
            placeholder: 'Find an order by name, phone, email or number',
            matches: (row, q) => {
              const needle = q.toLowerCase();
              const digits = q.replace(/\D/g, '');
              const address = Object.values(row.shippingAddress ?? {}).join(' ');
              return (
                (row.reference ?? '').toLowerCase().includes(needle) ||
                (row.guestEmail ?? '').toLowerCase().includes(needle) ||
                address.toLowerCase().includes(needle) ||
                // The customer's number is on the order, inside the address the
                // checkout collects. A number is written a dozen ways; compare
                // the digits.
                (digits.length >= 4 && address.replace(/\D/g, '').includes(digits))
              );
            },
          }}
          empty={
            <EmptyState
              title="No orders yet"
              description="Orders your customers place appear here, with the stage each one has reached."
              action={
                <Link href="/admin/settings">
                  <Button>Set your order stages</Button>
                </Link>
              }
            />
          }
          columns={[
            {
              title: 'Placed',
              dataIndex: 'createdAt',
              render: (at: string, row) => (
                <Link href={`/admin/orders/${row.id}`}>{formatRelative(at)}</Link>
              ),
            },
            {
              // Read from the row's own snapshot, so an order placed under an
              // older pipeline shows the stage name it was placed with.
              title: 'Stage',
              key: 'stage',
              render: (_, row) =>
                row.stages.find((stage) => stage.id === row.currentStageId)?.name ?? '—',
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (status: string) => <StatusTag status={status} />,
            },
            {
              title: 'Total',
              dataIndex: 'totalAmountMinor',
              className: 'mp-num',
              align: 'right' as const,
              render: (minor: number, row) => (
                <div className="mp-stack-tight" style={{ alignItems: 'flex-end' }}>
                  <span>{formatPrice(minor, row.currency)}</span>
                  {/* What she still has to collect in the room. Without it a
                      deposit order looks paid in full on the queue she works
                      from. */}
                  {row.balanceDueMinor > 0 && (
                    <span className="mp-sub">
                      {formatPrice(row.balanceDueMinor, row.currency)} due{' '}
                      {row.fulfilment === 'collection' ? 'on collection' : 'on delivery'}
                    </span>
                  )}
                </div>
              ),
            },
            {
              title: 'How',
              dataIndex: 'fulfilment',
              render: (fulfilment: string) =>
                fulfilment === 'collection' ? 'Collection' : 'Delivery',
            },
            {
              title: 'Ref',
              dataIndex: 'id',
              render: (id: string) => <Ref value={id} />,
            },
          ]}
        />
      </div>
    </>
  );
}
