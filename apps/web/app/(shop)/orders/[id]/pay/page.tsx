'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Alert, Button, Form, Input, InputNumber, message } from 'antd';
import { CreditCardOutlined } from '@ant-design/icons';
import { CardSchema, type OrderResponse } from '@marketplace/contracts';
import { getOrder } from '../../../../../lib/api/orders';
import { payOrder } from '../../../../../lib/api/checkout';
import { ProblemError } from '../../../../../lib/api/http';
import { useResource } from '../../../../../lib/use-resource';
import { formatMoney } from '../../../../../lib/format';
import { PageHeader } from '../../../../../components/page-header';
import { ErrorPanel } from '../../../../../components/error-panel';
import { DetailSkeleton } from '../../../../../components/skeletons';

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; detail?: string } | null>(null);

  const { data: order, error, loading, retry } = useResource<OrderResponse>(
    () => getOrder(id),
    [id],
  );

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!order) return null;

  // Refreshing after success, or deep-linking to a paid or cancelled order,
  // lands on the tracker instead of a dead form.
  if (order.status !== 'awaiting_payment') {
    router.replace(`/orders/${order.id}`);
    return null;
  }

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
      form.setFields([{ name: 'number', errors: ['Not a valid card number'] }]);
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await payOrder(order.id, parsed.data);
      void message.success('Payment received');
      router.push(`/orders/${order.id}`);
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

  return (
    <>
      <PageHeader
        title="Payment"
        subtitle={`${formatMoney(order.totalAmountMinor, order.currency)} ${order.currency} to pay`}
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

          <Form form={form} layout="vertical" onFinish={submit} className="mp-checkout-form">
            <Form.Item name="number" label="Card number" rules={[{ required: true }]}>
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
              Pay {formatMoney(order.totalAmountMinor, order.currency)} {order.currency}
            </Button>
          </Form>

          {/* A simulation should say so: these numbers select the outcome. */}
          <p className="mp-summary-note" style={{ marginTop: 16 }}>
            Simulated payment — 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined,
            4000 0000 0000 9995 has insufficient funds.
          </p>
        </div>
      </div>
    </>
  );
}
