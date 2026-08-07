'use client';

import Link from 'next/link';
import type { OrderResponse } from '@marketplace/contracts';
import { listOrders } from '../../lib/api/orders';
import { CursorTable } from '../../components/cursor-table';

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
        { title: 'Status', dataIndex: 'status' },
        { title: 'Items', render: (_, row) => row.items.length },
        {
          title: 'Total',
          dataIndex: 'totalAmountMinor',
          render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
        },
        { title: 'Placed', dataIndex: 'createdAt' },
      ]}
    />
  );
}
