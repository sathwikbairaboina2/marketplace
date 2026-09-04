'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Alert, Button, Descriptions, Popconfirm, Table } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import type { MessageResponse, OrderResponse } from '@marketplace/contracts';
import { cancelOrder } from '../../../../lib/api/orders';
import { useShopCommerce } from '../../../../lib/shop/commerce';
import { useShop } from '../../../../lib/shop/shop-context';
import { lookupOrder } from '../../../../lib/api/shop';
import { useShopReads } from '../../../../lib/shop/reads';
import { listWholeThread } from '../../../../lib/api/messages';
import { ProblemError } from '../../../../lib/api/http';
import { notifyProblem } from '../../../../lib/problem-notify';
import { StageTracker } from '../../../../components/stage-tracker';
import { StageThread } from '../../../../components/stage-thread';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useResource } from '../../../../lib/use-resource';
import { Ref } from '../../../../components/ref';
import { StatusTag } from '../../../../components/status-tag';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';
import { formatAddress, formatDateTime, formatPrice } from '../../../../lib/format';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const commerce = useShopCommerce();
  const shop = useShop();
  // Names come through the shop reads: public on a shop host, so a guest's
  // order page never touches a token route that would bounce them to login.
  const reads = useShopReads();
  // A guest back in a fresh browser arrives from the lookup form with the
  // email in the query; a guest in the browser that placed the order has
  // the ticket. Either reads the same order; neither reads anyone else's.
  const lookupEmail = useSearchParams().get('email');
  const schema = useSchema('Order');
  const {
    data: order,
    error,
    loading,
    retry,
  } = useResource<OrderResponse>(
    () =>
      commerce.guest && shop && lookupEmail
        ? lookupOrder(shop.tenantId, id, lookupEmail)
        : commerce.getOrder(id),
    [id, commerce, shop, lookupEmail],
  );

  // Declared above the early returns: a hook cannot live after a conditional
  // `return`. A line item carries only the id its price was locked against, and
  // an order has at most MAX_ORDER_LINE_ITEMS of them, so the names are resolved
  // here -- the same trade the booking page makes for its one event, and the
  // reason /orders (a whole list of orders) does not.
  const productIds = order?.items.map((item) => item.productId).join(',') ?? '';
  const { data: names } = useResource<Record<string, string>>(async () => {
    if (!productIds) return {};
    const resolved = await Promise.all(
      productIds.split(',').map(async (productId) => {
        // One unreachable product must not cost the order its other names, and
        // must not raise a toast either: the row degrades to its reference.
        try {
          return [productId, (await reads.getProduct(productId)).name] as const;
        } catch {
          return [productId, null] as const;
        }
      }),
    );
    return Object.fromEntries(resolved.filter(([, name]) => name !== null) as [string, string][]);
  }, [productIds, reads]);

  // Declared with the other hooks, above the early returns. Closed threads come
  // back too -- they are the history -- and are grouped by stage below against
  // the order's own snapshot.
  const {
    data: messagePage,
    retry: retryMessages,
  } = useResource<{ items: MessageResponse[]; truncated: boolean }>(
    // The thread is a token route; a stranger has no thread yet, and asking
    // would only bounce them to the login page.
    () => (commerce.guest ? Promise.resolve({ items: [], truncated: false }) : listWholeThread(id)),
    [id, commerce],
  );

  if (loading) return <DetailSkeleton />;
  // A stranger's lookup that matched nothing is not a fault to retry: one of
  // the two things they typed is wrong, and the form is where to fix it.
  if (commerce.guest && error instanceof ProblemError && error.status === 404) {
    return (
      <EmptyState
        title="No order matches"
        description="Check the order number from your confirmation and the email you gave at checkout — both have to match."
        action={
          <Link href="/orders">
            <Button type="primary">Try again</Button>
          </Link>
        }
      />
    );
  }
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!order) return null;

  const money = (minor: number) => formatPrice(minor, order.currency);
  const attributeRows = schema ? toDescriptionRows(schema.fields, order.attributes) : [];

  const messages = messagePage?.items ?? [];
  const awaitingPayment = order.status === 'awaiting_payment';
  const currentStage = order.stages.find((stage) => stage.id === order.currentStageId);
  // An order in the payment gate is always cancellable: no money has moved and
  // no stage has begun.
  const canCancel =
    awaitingPayment || (order.status === 'confirmed' && currentStage?.cancellable === true);

  const cancel = async () => {
    try {
      // A guest cancels through the shop's own route, proving the order with
      // the ticket or with the email they looked it up under -- an unpaid
      // order holds stock, and before this the seller was the only one who
      // could give it back.
      await (commerce.guest
        ? commerce.cancelOrder(order.id, lookupEmail ?? undefined)
        : cancelOrder(order.id));
      retry();
    } catch (err) {
      // The seller can advance this order between the page rendering and the
      // click. The engine refuses on the stage condition rather than cancelling
      // goods that have just gone out; the honest response is to reload and show
      // what actually happened, never to replay the click.
      notifyProblem(err);
      if (err instanceof ProblemError && err.type.includes('stage-moved')) retry();
    }
  };

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
                // What was bought, in the words the buyer chose it by. Until the
                // name lands -- or if the product is gone -- the row still
                // identifies itself by reference rather than by nothing.
                render: (productId: string) =>
                  names?.[productId] ? (
                    <Link href={`/products/${productId}`}>{names[productId]}</Link>
                  ) : (
                    <Ref value={productId} href={`/products/${productId}`} />
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
          <h2>Progress</h2>
          {/* The payment gate sits before the stage list: until it clears, the
              tracker would misreport the order as already in stage one. */}
          {awaitingPayment && (
            <Alert
              type="warning"
              showIcon
              message="Awaiting payment"
              description="This order is reserved but unpaid. Fulfilment begins when payment lands."
              style={{ marginBottom: 12 }}
              data-testid="awaiting-payment"
              action={
                <Link
                  href={`/orders/${order.id}/pay${
                    lookupEmail ? `?email=${encodeURIComponent(lookupEmail)}` : ''
                  }`}
                >
                  <Button type="primary" size="small" data-testid="pay-now-link">
                    Pay now
                  </Button>
                </Link>
              }
            />
          )}
          {!awaitingPayment && (
          <StageTracker
            stages={order.stages}
            currentStageId={order.currentStageId ?? ''}
            cancelled={order.status === 'cancelled'}
            renderStageExtra={(stage, state) => {
              // Messages are a buyer's; a guest has no thread to open.
              if (!stage.messaging || commerce.guest) return null;
              const forStage = messages.filter((message) => message.stageId === stage.id);
              // A stage already passed with nothing said in it is not worth a heading.
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
          )}

          {commerce.guest && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              message={
                <>
                  Your order number is <strong className="mp-num">{order.reference}</strong>
                </>
              }
              description="Keep it with the email you gave. Together they find this order again from any browser, under Orders."
            />
          )}

          {canCancel && (
            /* Popconfirm, never window.confirm: a native modal blocks the
               browser harness and takes the whole campaign with it. */
            <Popconfirm
              title="Cancel this order?"
              description="The items go back into stock."
              okText="Cancel order"
              cancelText="Keep it"
              onConfirm={cancel}
            >
              <Button danger block style={{ marginTop: 12 }}>
                Cancel order
              </Button>
            </Popconfirm>
          )}

          <h2>Summary</h2>
          <div className="mp-summary-row mp-summary-total">
            <span>Total</span>
            <span className="mp-num">{money(order.totalAmountMinor)}</span>
          </div>
          <div className="mp-summary-block">
            <h3>Shipping to</h3>
            {/* In the order an address is written, not the order the object's
                keys happen to iterate: this printed "411004, Pune, 12 Karve
                Road". Anything the shop asked for that is not one of the known
                lines still follows, so a tenant's own field is never dropped. */}
            <p>{formatAddress(order.shippingAddress)}</p>
          </div>
          <div className="mp-summary-block">
            <h3>Order number</h3>
            {/* The reference, not the ULID: a shopper reads this one back over
                the phone, and the lookup takes either. */}
            <code className="mp-id">{order.reference}</code>
          </div>
        </aside>
      </div>
    </>
  );
}
