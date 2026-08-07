'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Card, Descriptions, Table } from 'antd';
import type { OrderResponse } from '@marketplace/contracts';
import { getOrder } from '../../../../lib/api/orders';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../lib/use-resource';
import { StatusTag } from '../../../../components/status-tag';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';
import { formatDateTime, formatMoney } from '../../../../lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Order');
  const {
    data: order,
    error,
    loading,
    retry,
  } = useResource<OrderResponse>(() => getOrder(id), [id]);

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!order) return null;

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
          {
            title: 'Product',
            dataIndex: 'productId',
            // A line item carries no name, only the id the price was locked
            // against, so the link is what makes the row identifiable at all.
            render: (productId: string) => (
              <Link className="mp-id" href={`/products/${productId}`}>
                {productId}
              </Link>
            ),
          },
          { title: 'Qty', dataIndex: 'quantity', align: 'right', width: 80 },
          {
            title: 'Unit price',
            dataIndex: 'unitPriceMinor',
            align: 'right',
            width: 160,
            render: (minor: number) => `${formatMoney(minor)} ${order.currency}`,
          },
          {
            title: 'Line total',
            key: 'lineTotal',
            align: 'right',
            width: 160,
            render: (_: unknown, item: OrderResponse['items'][number]) =>
              `${formatMoney(item.unitPriceMinor * item.quantity)} ${order.currency}`,
          },
        ]}
      />
    </Card>
  );
}
