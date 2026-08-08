'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Descriptions, Table } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { OrderResponse } from '@marketplace/contracts';
import { getOrder } from '../../../../lib/api/orders';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../lib/use-resource';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';
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

  const money = (minor: number) => `${formatMoney(minor)} ${order.currency}`;
  const attributeRows = schema ? toDescriptionRows(schema.fields, order.attributes) : [];

  return (
    <>
      <Link href="/orders" className="mp-back">
        <ArrowLeftOutlined /> All orders
      </Link>

      {/* The id was the page title, which made every order look alike at a
          glance. What was ordered leads; the reference is a fact in the aside
          like any other. */}
      <PageHeader
        title="Order"
        subtitle={`Placed ${formatDateTime(order.createdAt)}`}
        extra={<StatusTag status={order.status} />}
      />

      <div className="mp-checkout">
        <div className="mp-checkout-main">
          {/* unitPriceMinor is what the engine locked at order time, not what
              the product costs now. */}
          <Table
            rowKey="productId"
            pagination={false}
            dataSource={order.items}
            columns={[
              {
                title: 'Product',
                dataIndex: 'productId',
                // A line item carries no name, only the id the price was
                // locked against, so the link is what makes the row
                // identifiable at all.
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
                width: 150,
                render: (minor: number) => money(minor),
              },
              {
                title: 'Line total',
                key: 'lineTotal',
                align: 'right',
                width: 150,
                render: (_: unknown, item: OrderResponse['items'][number]) =>
                  money(item.unitPriceMinor * item.quantity),
              },
            ]}
          />

          {attributeRows.length > 0 && (
            <div className="mp-detail-specs">
              <h2>Order details</h2>
              <Descriptions column={1} size="small" items={attributeRows} />
            </div>
          )}
        </div>

        <aside className="mp-summary">
          <h2>Summary</h2>
          <div className="mp-summary-row mp-summary-total">
            <span>Total</span>
            <span className="mp-num">{money(order.totalAmountMinor)}</span>
          </div>
          <div className="mp-summary-block">
            <h3>Shipping to</h3>
            <p>{Object.values(order.shippingAddress).join(', ')}</p>
          </div>
          <div className="mp-summary-block">
            <h3>Reference</h3>
            <code className="mp-id">{order.id}</code>
          </div>
        </aside>
      </div>
    </>
  );
}
