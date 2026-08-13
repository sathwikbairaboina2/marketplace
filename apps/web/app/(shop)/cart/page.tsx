'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Form, Input, InputNumber, Select, message } from 'antd';
import { DeleteOutlined, ShoppingOutlined } from '@ant-design/icons';
import { createOrder } from '../../../lib/api/orders';
import { useCart } from '../../../lib/cart/cart-context';
import { ProblemError } from '../../../lib/api/http';
import { notifyProblem } from '../../../lib/problem-notify';
import { toAttributes, toFormItems } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { formatMoney } from '../../../lib/format';
import { placeholderFor } from '../../../lib/placeholder';
import { PageHeader } from '../../../components/page-header';
import { EmptyState } from '../../../components/empty-state';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CartPage() {
  const { lines, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  const schema = useSchema('Order');
  const router = useRouter();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  // Every amount on this page is denominated in whatever the order will be
  // placed in, so the summary follows the field rather than naming a currency
  // of its own. useWatch is undefined on first render, before initialValues
  // have been applied.
  const currency = (Form.useWatch('currency', form) as string | undefined) ?? 'USD';

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      const body = {
        items: lines.map((l) => ({ productId: l.productId, quantity: l.qty })),
        currency: values.currency as string,
        shippingAddress: {
          line1: values.line1 as string,
          city: values.city as string,
          postcode: values.postcode as string,
        },
        attributes: toAttributes(
          schema?.fields ?? {},
          (values.attributes ?? {}) as Record<string, unknown>,
        ),
      };

      // Every attempt reuses the same key. A 409 means the first attempt is
      // still in flight, not that anything is wrong -- backing off with the
      // same key eventually returns that first attempt's stored response
      // rather than creating a second order.
      for (let attempt = 0; ; attempt++) {
        try {
          const order = await createOrder(body, idempotencyKey);
          clear();
          resetKey();
          void message.success('Order placed');
          router.push(`/orders/${order.id}`);
          return;
        } catch (err) {
          const inProgress = err instanceof ProblemError && err.status === 409;
          if (!inProgress || attempt >= BACKOFFS_MS.length - 1) throw err;
          await sleep(BACKOFFS_MS[attempt]!);
        }
      }
    } catch (err) {
      notifyProblem(err);
    } finally {
      setBusy(false);
    }
  };

  if (!lines.length) {
    return (
      <>
        <PageHeader title="Cart" />
        <EmptyState
          icon={<ShoppingOutlined />}
          title="Your cart is empty"
          description="Add something from the shop and it will appear here."
          action={
            <Link href="/products">
              <Button type="primary">Browse products</Button>
            </Link>
          }
        />
      </>
    );
  }

  const total = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);
  const units = lines.reduce((sum, l) => sum + l.qty, 0);

  return (
    <>
      <PageHeader title="Cart" subtitle={`${units} item${units === 1 ? '' : 's'} ready to order`} />

      {/* Items on the left, a sticky summary carrying the total and the only
          primary action on the right. Previously the total was a sentence in
          body text and Place order sat at the bottom of a long form. */}
      <div className="mp-checkout">
        <div className="mp-checkout-main">
          <ul className="mp-lines">
            {lines.map((line) => (
              <li key={line.productId} className="mp-line">
                {/* A line the buyer can recognise at a glance -- the photo if
                    there is one, the same palette tile as everywhere else if
                    not. */}
                {line.image ? (
                  <img src={line.image} alt="" className="mp-table-thumb" />
                ) : (
                  <span
                    className="mp-thumb-placeholder"
                    style={{ background: placeholderFor(line.productId, line.name).gradient }}
                  >
                    {placeholderFor(line.productId, line.name).initials}
                  </span>
                )}
                <div className="mp-line-info">
                  <Link href={`/products/${line.productId}`} className="mp-line-name">
                    {line.name}
                  </Link>
                  <span className="mp-line-unit">
                    {formatMoney(line.priceMinor)} {currency} each
                  </span>
                </div>
                <InputNumber
                  min={1}
                  value={line.qty}
                  aria-label={`Quantity for ${line.name}`}
                  onChange={(v) => setQty(line.productId, v ?? 1)}
                />
                <span className="mp-line-total">
                  {formatMoney(line.priceMinor * line.qty)} {currency}
                </span>
                <Button
                  type="text"
                  aria-label={`Remove ${line.name}`}
                  icon={<DeleteOutlined />}
                  onClick={() => remove(line.productId)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <Form
            form={form}
            layout="vertical"
            onFinish={submit}
            initialValues={{ currency: 'USD' }}
            id="checkout-form"
            className="mp-checkout-form"
          >
            <h2>Delivery</h2>
            <Form.Item name="line1" label="Address" rules={[{ required: true }]}>
              <Input placeholder="42 Harbour Road" />
            </Form.Item>
            <div className="mp-field-row">
              <Form.Item name="city" label="City" rules={[{ required: true }]}>
                <Input placeholder="Bristol" />
              </Form.Item>
              <Form.Item name="postcode" label="Postcode" rules={[{ required: true }]}>
                <Input placeholder="BS1 4TR" />
              </Form.Item>
              <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
                <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
              </Form.Item>
            </div>
            {schema && Object.keys(schema.fields).length > 0 && (
              <>
                <h2>Order details</h2>
                {toFormItems(schema.fields)}
              </>
            )}
          </Form>
        </div>

        <aside className="mp-summary">
          <h2>Summary</h2>
          <div className="mp-summary-row">
            <span>
              Subtotal · {units} item{units === 1 ? '' : 's'}
            </span>
            <span className="mp-num">
              {formatMoney(total)} {currency}
            </span>
          </div>
          <div className="mp-summary-row mp-summary-total">
            <span>Total</span>
            <span className="mp-num">
              {formatMoney(total)} {currency}
            </span>
          </div>
          {/* Indicative only: POST /orders locks unit prices server-side at
              order time, so a stale cached price is a display concern and never
              a correctness one. */}
          <p className="mp-summary-note">
            Prices are confirmed when the order is placed.
          </p>
          <Button
            type="primary"
            size="large"
            block
            htmlType="submit"
            form="checkout-form"
            loading={busy}
            disabled={busy}
          >
            Place order
          </Button>
        </aside>
      </div>
    </>
  );
}
