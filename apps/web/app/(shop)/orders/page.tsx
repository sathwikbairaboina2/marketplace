'use client';

import Link from 'next/link';
import type { OrderResponse } from '@marketplace/contracts';
import { listOrders } from '../../../lib/api/orders';
import { formatMoney, formatRelative } from '../../../lib/format';
import { CursorTable } from '../../../components/cursor-table';
import { StatusTag } from '../../../components/status-tag';

export default function OrdersPage() {
  return (
    <CursorTable<OrderResponse>
      rowKey="id"
      load={(cursor) => listOrders(25, cursor)}
      columns={[
        {
          title: 'Order',
          dataIndex: 'id',
          render: (id: string) => <Link href={`/orders/${id}`}>{id}</Link>,
        },
        {
          title: 'Status',
          dataIndex: 'status',
          render: (status: string) => <StatusTag status={status} />,
        },
        { title: 'Items', render: (_, row) => row.items.length },
        {
          title: 'Total',
          dataIndex: 'totalAmountMinor',
          className: 'mp-num',
          render: (minor: number, row) => `${formatMoney(minor)} ${row.currency}`,
        },
        {
          title: 'Placed',
          dataIndex: 'createdAt',
          render: (at: string) => formatRelative(at),
        },
      ]}
    />
  );
}
