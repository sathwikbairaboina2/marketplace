'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { listAllOrders } from '../../../../lib/api/orders';
import { formatMoney, formatRelative } from '../../../../lib/format';
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
              render: (minor: number, row) => `${formatMoney(minor, row.currency)} ${row.currency}`,
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
