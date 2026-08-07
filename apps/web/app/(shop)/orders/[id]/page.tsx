'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Spin, Table } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { getOrder } from '../../../../lib/api/orders';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { notifyProblem } from '../../../../lib/problem-notify';
import { StatusTag } from '../../../../components/status-tag';
import { formatDateTime, formatMoney } from '../../../../lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Order');
  const [order, setOrder] = useState<OrderResponse | null>(null);

  useEffect(() => {
    getOrder(id).then(setOrder).catch(notifyProblem);
  }, [id]);

  if (!order) return <Spin />;

  return (
    <Card title={`Order ${order.id}`}>
      <Descriptions
        column={1}
        items={[
          { key: 'status', label: 'Status', children: <StatusTag status={order.status} /> },
          {
            key: 'total',
            label: 'Total',
            children: `${formatMoney(order.totalAmountMinor)} ${order.currency}`,
          },
          {
            key: 'shipping',
            label: 'Shipping to',
            children: Object.values(order.shippingAddress).join(', '),
          },
          { key: 'placed', label: 'Placed', children: formatDateTime(order.createdAt) },
          ...(schema ? toDescriptionRows(schema.fields, order.attributes) : []),
        ]}
      />
      {/* unitPriceMinor is what the engine locked at order time, not what the
          product costs now. */}
      <Table
        style={{ marginTop: 16 }}
        rowKey="productId"
        pagination={false}
        dataSource={order.items}
        columns={[
          { title: 'Product', dataIndex: 'productId' },
          { title: 'Qty', dataIndex: 'quantity' },
          {
            title: 'Unit price',
            dataIndex: 'unitPriceMinor',
            render: (minor: number) => formatMoney(minor),
          },
        ]}
      />
    </Card>
  );
}
