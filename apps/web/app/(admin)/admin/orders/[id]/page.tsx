'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Button, Descriptions, Popconfirm, Table } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { MessageResponse, OrderResponse } from '@marketplace/contracts';
import { advanceOrder, cancelOrder, getOrder } from '../../../../../lib/api/orders';
import { listWholeThread } from '../../../../../lib/api/messages';
import { ProblemError } from '../../../../../lib/api/http';
import { notifyProblem } from '../../../../../lib/problem-notify';
import { useResource } from '../../../../../lib/use-resource';
import { StatusTag } from '../../../../../components/status-tag';
import { PageHeader } from '../../../../../components/page-header';
import { ErrorPanel } from '../../../../../components/error-panel';
import { DetailSkeleton } from '../../../../../components/skeletons';
import { StageTracker } from '../../../../../components/stage-tracker';
import { StageThread } from '../../../../../components/stage-thread';
import { Ref } from '../../../../../components/ref';
import { ProductName } from '../../../../../components/record-name';
import { formatDateTime, formatMoney } from '../../../../../lib/format';

/**
 * The seller's side of one order: where it is, what to do next, and the
 * customer's messages. The advance button names the next stage rather than
 * saying "advance", because the stages are the shop's own words.
 */
export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error, loading, retry } = useResource<OrderResponse>(
    () => getOrder(id),
    [id],
  );
  const { data: messagePage, retry: retryMessages } = useResource<{
    items: MessageResponse[];
    truncated: boolean;
  }>(() => listWholeThread(id), [id]);

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!order) return null;

  const messages = messagePage?.items ?? [];
  const index = order.stages.findIndex((stage) => stage.id === order.currentStageId);
  const next = order.stages[index + 1];
  const money = (minor: number) => `${formatMoney(minor, order.currency)} ${order.currency}`;

  const advance = async () => {
    // An awaiting_payment order has no stage to advance from; the button is
    // not rendered for one, and the service refuses regardless.
    if (!order.currentStageId) return;
    try {
      // The stage the seller is looking at, so a stale page cannot skip a stage.
      await advanceOrder(order.id, order.currentStageId);
      retry();
    } catch (err) {
      notifyProblem(err);
      if (err instanceof ProblemError && err.type.includes('stage-moved')) retry();
    }
  };

  return (
    <>
      <Link href="/admin/orders" className="mp-back">
        <ArrowLeftOutlined /> All orders
      </Link>

      <PageHeader
        title="Order"
        subtitle={`Placed ${formatDateTime(order.createdAt)}`}
        extra={<StatusTag status={order.status} />}
      />

      <div className="mp-checkout">
        <div className="mp-checkout-main">
          <Table
            rowKey="productId"
            pagination={false}
            dataSource={order.items}
            columns={[
              {
                title: 'Product',
                dataIndex: 'productId',
                // The name, as the buyer's page shows it; the ref only until it
                // resolves. A seller packing "AZ4SRG" has to open it to learn
                // what it is.
                render: (productId: string) => (
                  <ProductName id={productId} href={`/admin/products/${productId}/edit`} />
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
            ]}
          />

          <div className="mp-detail-specs">
            <h2>Shipping to</h2>
            <Descriptions
              column={1}
              size="small"
              items={Object.entries(order.shippingAddress).map(([label, value]) => ({
                key: label,
                label,
                children: value,
              }))}
            />
          </div>
        </div>

        <aside className="mp-summary">
          <h2>Progress</h2>
          <StageTracker
            stages={order.stages}
            // An unpaid order points at no stage; the tracker's own unknown-id
            // fallback renders it at the first stage until payment lands.
            currentStageId={order.currentStageId ?? ''}
            cancelled={order.status === 'cancelled'}
            renderStageExtra={(stage, state) => {
              if (!stage.messaging) return null;
              const forStage = messages.filter((message) => message.stageId === stage.id);
              if (state !== 'current' && forStage.length === 0) return null;
              return (
                <StageThread
                  orderId={order.id}
                  messages={forStage}
                  open={state === 'current' && order.status === 'confirmed'}
                  onPosted={retryMessages}
                />
              );
            }}
          />

          {/* Rendered only when there is somewhere to go. A shop that has never
              configured its stages has exactly one, so every advance there is a
              legitimate 409 -- the seller should meet that as a missing button,
              not as an error. An awaiting_payment order is not 'confirmed', so
              the button never renders for one; the service refuses regardless. */}
          {next && order.status === 'confirmed' && (
            <Button type="primary" block style={{ marginTop: 12 }} onClick={advance}>
              Advance to {next.name}
            </Button>
          )}

          {order.status === 'awaiting_payment' && (
            <>
              <Alert
                type="warning"
                showIcon
                message="Awaiting payment"
                description="The stock is reserved but nothing has been charged. Don't dispatch this order."
                style={{ marginTop: 12 }}
                data-testid="admin-awaiting-payment"
              />
              {/* Cancelling an unpaid order is the seller reclaiming their
                  stock. Popconfirm, never window.confirm. */}
              <Popconfirm
                title="Cancel this unpaid order?"
                description="The items go back into stock."
                okText="Cancel order"
                cancelText="Keep it"
                onConfirm={async () => {
                  try {
                    await cancelOrder(order.id);
                    retry();
                  } catch (err) {
                    notifyProblem(err);
                  }
                }}
              >
                <Button danger block style={{ marginTop: 12 }} data-testid="admin-cancel-unpaid">
                  Cancel unpaid order
                </Button>
              </Popconfirm>
            </>
          )}

          <div className="mp-summary-row mp-summary-total" style={{ marginTop: 16 }}>
            <span>Total</span>
            <span className="mp-num">{money(order.totalAmountMinor)}</span>
          </div>
        </aside>
      </div>
    </>
  );
}
