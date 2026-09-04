'use client';

import { useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Form, Input, InputNumber, Radio, message } from 'antd';
import { CreditCardOutlined, MobileOutlined } from '@ant-design/icons';
import { CardSchema, type OrderResponse, type PaymentIntentResponse } from '@marketplace/contracts';
import { useShopCommerce } from '../../../../../lib/shop/commerce';
import { useShop } from '../../../../../lib/shop/shop-context';
import { lookupOrder } from '../../../../../lib/api/shop';
import { ProblemError } from '../../../../../lib/api/http';
import { useResource } from '../../../../../lib/use-resource';
import { formatPrice } from '../../../../../lib/format';
import { PageHeader } from '../../../../../components/page-header';
import { ErrorPanel } from '../../../../../components/error-panel';
import { DetailSkeleton } from '../../../../../components/skeletons';
import { UpiWaiting } from '../../../../../components/upi-waiting';

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null);
  // UPI leads. Nobody in this market pays for a ₹1,400 mug by card, and the
  // page offered nothing else.
  const [method, setMethod] = useState<'upi' | 'card'>('upi');
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);

  const commerce = useShopCommerce();
  const shop = useShop();
  // The same `?email=` the order page reads. A guest ticket belongs to a
  // browser and this order does not: a shopper who signed in, cleared storage
  // or came back on another device reaches the order through the lookup, and
  // without carrying its email here the page they arrive at cannot pay.
  const lookupEmail = useSearchParams().get('email');
  const { data: order, error, loading, retry } = useResource<OrderResponse>(
    () =>
      commerce.guest && shop && lookupEmail
        ? lookupOrder(shop.tenantId, id, lookupEmail)
        : commerce.getOrder(id),
    [id, commerce, shop, lookupEmail],
  );

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!order) return null;

  // Refreshing after success, or deep-linking to a paid or cancelled order,
  // lands on the tracker instead of a dead form.
  if (order.status !== 'awaiting_payment') {
    router.replace(`/orders/${order.id}${lookupEmail ? `?email=${encodeURIComponent(lookupEmail)}` : ''}`);
    return null;
  }

  /**
   * Start a UPI collect request. This never returns a result: it hands back
   * somewhere to approve and an id, and the waiting screen takes over.
   */
  const startUpi = async (values: { vpa?: string }) => {
    setBusy(true);
    setProblem(null);
    try {
      setIntent(
        await commerce.startPayment(
          order.id,
          { method: 'upi', vpa: values.vpa?.trim() || undefined },
          lookupEmail ?? undefined,
        ),
      );
    } catch (err) {
      if (err instanceof ProblemError) setProblem({ title: err.title, detail: err.detail });
      else setProblem({ title: 'Could not start the payment', detail: 'Try again in a moment.' });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (values: Record<string, unknown>) => {
    // The same validation the engine applies, run here first so a mistyped
    // number is an inline field error rather than a round trip.
    const parsed = CardSchema.safeParse({
      number: values.number as string,
      expMonth: values.expMonth as number,
      expYear: values.expYear as number,
      cvc: values.cvc as string,
    });
    if (!parsed.success) {
      // Held in state rather than pushed through `form.setFields`. The card
      // form is mounted only while its own tab is showing, so the `useForm`
      // instance is not connected when the page opens on UPI -- and antd's
      // setFields on an unconnected instance is a silent no-op, which meant a
      // shopper who switched to Card and mistyped saw nothing at all.
      setCardError('Not a valid card number');
      return;
    }
    setCardError(null);

    setBusy(true);
    setProblem(null);
    try {
      await commerce.payOrder(order.id, parsed.data, lookupEmail ?? undefined);
      void message.success('Payment received');
      router.push(`/orders/${order.id}${lookupEmail ? `?email=${encodeURIComponent(lookupEmail)}` : ''}`);
    } catch (err) {
      // A refusal renders inline with the form intact for another card; only
      // problem-shaped failures are expected here.
      if (err instanceof ProblemError) {
        setProblem({ title: err.title, detail: err.detail });
      } else {
        setProblem({ title: 'Payment failed', detail: 'Something went wrong; try again.' });
      }
    } finally {
      setBusy(false);
    }
  };

  if (intent) {
    return (
      <>
        {/* The reference is on the waiting screen itself, where it stays put
            as the copy changes. Printing it here as well was the duplication
            round 3 struck off the order page. */}
        <PageHeader
          title="Waiting for your bank"
          subtitle="Approve the request in your UPI app — this page updates itself."
        />
        <UpiWaiting
          amountMinor={intent.amountMinor}
          currency={intent.currency}
          reference={order.reference}
          approvalUrl={intent.approvalUrl}
          onCheck={() => commerce.paymentStatus(intent.intentId)}
          onSettled={(result) => {
            if (result.state === 'paid') {
              void message.success('Payment received');
              router.push(
                `/orders/${order.id}${lookupEmail ? `?email=${encodeURIComponent(lookupEmail)}` : ''}`,
              );
              return;
            }
            // Declined or expired: back to choosing, with the reason said
            // plainly rather than as a failure the shopper caused.
            setIntent(null);
            setProblem({
              title: result.state === 'expired' ? 'That request timed out' : 'The payment was not approved',
              detail: 'Nothing has been taken. You can try again.',
            });
          }}
          onGiveUp={() => setIntent(null)}
        />
      </>
    );
  }

  // `?? 0` rather than a bare subtraction: an order that reached this page
  // without the field would otherwise render "Pay $NaN", which is how a test
  // fixture written before deposits existed found this.
  const payableNow = order.totalAmountMinor - (order.balanceDueMinor ?? 0);

  return (
    <>
      <PageHeader
        title="Payment"
        subtitle={`${formatPrice(payableNow, order.currency)} to pay`}
      />

      <div className="mp-checkout">
        <div className="mp-checkout-main">
          {problem && (
            <Alert
              type="error"
              showIcon
              message={problem.title}
              description={problem.detail}
              style={{ marginBottom: 16 }}
              data-testid="pay-problem"
            />
          )}

          {order.balanceDueMinor > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${formatPrice(order.balanceDueMinor, order.currency)} is due ${
                order.fulfilment === 'collection' ? 'when you collect' : 'on delivery'
              }`}
              description={`Paying ${formatPrice(payableNow, order.currency)} now.`}
            />
          )}

          {/* Radio.Group, not Segmented: Segmented's inputs carry no
              accessible name, so the choice was unreachable by label -- and
              this is the screen where that matters most. The cart makes the
              same choice for delivery. */}
          <Radio.Group
            value={method}
            onChange={(e) => setMethod(e.target.value as 'upi' | 'card')}
            style={{ marginBottom: 'var(--mp-space-5)' }}
          >
            <Radio.Button value="upi">
              <MobileOutlined /> UPI
            </Radio.Button>
            <Radio.Button value="card">
              <CreditCardOutlined /> Card
            </Radio.Button>
          </Radio.Group>

          {/* Each branch owns its own <Form>. The card instance is created by
              `useForm` at the top of this component and is only *connected*
              while the card tab is showing -- which is why the inline "not a
              valid card number" error is set from inside `submit`, a handler
              that can only run when that form is on screen. */}
          {method === 'upi' ? (
            <Form layout="vertical" onFinish={startUpi} className="mp-checkout-form">
              <Form.Item
                name="vpa"
                label="Your UPI id"
                extra="We send a request to your app. Approve it there and this page updates itself."
              >
                <Input placeholder="you@upi" autoComplete="off" data-testid="upi-vpa" />
              </Form.Item>
              <Button
                type="primary"
                size="large"
                block
                htmlType="submit"
                loading={busy}
                disabled={busy}
                data-testid="upi-pay"
              >
                Pay {formatPrice(payableNow, order.currency)} by UPI
              </Button>
            </Form>
          ) : (
          <Form form={form} layout="vertical" onFinish={submit} className="mp-checkout-form">
            <Form.Item
              name="number"
              label="Card number"
              rules={[{ required: true }]}
              validateStatus={cardError ? 'error' : undefined}
              help={cardError ?? undefined}
            >
              <Input
                placeholder="4242 4242 4242 4242"
                autoComplete="cc-number"
                data-testid="card-number"
              />
            </Form.Item>
            <div className="mp-field-row">
              <Form.Item name="expMonth" label="Month" rules={[{ required: true }]}>
                <InputNumber min={1} max={12} placeholder="MM" data-testid="card-month" />
              </Form.Item>
              <Form.Item name="expYear" label="Year" rules={[{ required: true }]}>
                <InputNumber min={2026} max={2100} placeholder="YYYY" data-testid="card-year" />
              </Form.Item>
              <Form.Item name="cvc" label="CVC" rules={[{ required: true }]}>
                <Input placeholder="123" maxLength={4} data-testid="card-cvc" />
              </Form.Item>
            </div>
            <Button
              type="primary"
              size="large"
              icon={<CreditCardOutlined />}
              htmlType="submit"
              loading={busy}
              disabled={busy}
              data-testid="pay-now"
            >
              Pay {formatPrice(payableNow, order.currency)}
            </Button>
          </Form>
          )}

          {/* A simulation should say so. Kept off the UPI tab: a shopper does
              not need a list of card numbers to approve a request in their own
              banking app. */}
          {method === 'card' && (
            <p className="mp-summary-note" style={{ marginTop: 16 }}>
              Simulated payment — 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined,
              4000 0000 0000 9995 has insufficient funds.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
