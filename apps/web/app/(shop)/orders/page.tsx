'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { listOrders } from '../../../lib/api/orders';
import { formatMoney, formatRelative } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';
import { EmptyState } from '../../../components/empty-state';
import { StatusTag } from '../../../components/status-tag';
import { PageHeader } from '../../../components/page-header';
import { Ref } from '../../../components/ref';

export default function OrdersPage() {
  return (
    <>
      {/* No count in the subtitle: cursor pagination cannot supply one, and a
          count of what happens to be loaded changes on "Load more". */}
      <PageHeader
        title="Orders"
        subtitle="Everything you have placed, at the prices they were locked at."
      />
      <CursorTable<OrderResponse>
        rowKey="id"
        caption="Your orders"
        noun={{ one: 'order', many: 'orders' }}
        load={(cursor) => listOrders(25, cursor)}
        empty={
          <EmptyState
            title="No orders yet"
            description="Orders you place appear here, with the prices they were locked at."
            action={
              <Link href="/products">
                <Button type="primary">Browse products</Button>
              </Link>
            }
          />
        }
        columns={[
          {
            // When an order happened is what a buyer recognises; its ULID is
            // not. The link moves here so the row still has exactly one route
            // into the record.
            title: 'Placed',
            dataIndex: 'createdAt',
            render: (at: string, row) => (
              <Link href={`/orders/${row.id}`}>{formatRelative(at)}</Link>
            ),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (status: string) => <StatusTag status={status} />,
          },
          {
            title: 'Items',
            className: 'mp-num',
            align: 'right' as const,
            render: (_, row) => row.items.length,
          },
          {
            title: 'Total',
            dataIndex: 'totalAmountMinor',
            className: 'mp-num',
            align: 'right' as const,
            render: (minor: number, row) => `${formatMoney(minor)} ${row.currency}`,
          },
          {
            title: 'Ref',
            dataIndex: 'id',
            render: (id: string) => <Ref value={id} />,
          },
        ]}
      />
    </>
  );
}
