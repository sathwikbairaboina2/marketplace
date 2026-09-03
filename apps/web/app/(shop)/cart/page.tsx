'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Form, Input, InputNumber } from 'antd';
import { DeleteOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useCart } from '../../../lib/cart/cart-context';
import { useShopCommerce } from '../../../lib/shop/commerce';
import { ProblemError } from '../../../lib/api/http';
import { notifyProblem } from '../../../lib/problem-notify';
import { toAttributes, toFormItems } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { formatPrice } from '../../../lib/format';
import { placeholderFor } from '../../../lib/placeholder';
import { PageHeader } from '../../../components/page-header';
import { EmptyState } from '../../../components/empty-state';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CartPage() {
  const { cart, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  const commerce = useShopCommerce();
  const { lines } = cart;
  const schema = useSchema('Order');
  const router = useRouter();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);

  // The order is placed in the currency the products are priced in: the
  // engine refuses a mixed-currency order, so the one thing a currency field
  // on this page could do was make checkout fail. The shopper is not asked.
  // An unavailable line carries a placeholder currency; skip it if there is
  // anything better.
  const currency = lines.find((l) => !l.unavailable)?.currency ?? lines[0]?.currency ?? 'USD';

  const submit = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      // The items come from the server-side cart, not from this page: the
      // checkout body carries only the facts the cart cannot know.
      const body = {
        currency,
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
          const order = await commerce.checkout(body, idempotencyKey, values.email as string | undefined);
          // The engine cleared the cart; refresh the mirror and mint a fresh
          // key for the next intent. Payment happens on the next screen.
          void clear();
          resetKey();
          router.push(`/orders/${order.id}/pay`);
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

  // The server computes the total over available lines; the page renders it.
  const total = cart.totalMinor;
  const units = lines.filter((l) => !l.unavailable).reduce((sum, l) => sum + l.qty, 0);

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
              <li
                key={line.productId}
                className="mp-line"
                data-unavailable={line.unavailable || undefined}
              >
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
                  {/* A struck-through line stays visible rather than silently
                      vanishing: the buyer removes it themselves. */}
                  <Link
                    href={`/products/${line.productId}`}
                    className="mp-line-name"
                    style={line.unavailable ? { textDecoration: 'line-through' } : undefined}
                  >
                    {line.name}
                  </Link>
                  <span className="mp-line-unit">
                    {line.unavailable
                      ? 'No longer available'
                      : `${formatPrice(line.unitPriceMinor, currency)} each`}
                  </span>
                </div>
                <InputNumber
                  min={1}
                  value={line.qty}
                  disabled={line.unavailable}
                  aria-label={`Quantity for ${line.name}`}
                  onChange={(v) => void setQty(line.productId, v ?? 1)}
                />
                <span className="mp-line-total">
                  {line.unavailable
                    ? '—'
                    : formatPrice(line.unitPriceMinor * line.qty, currency)}
                </span>
                <Button
                  type="text"
                  aria-label={`Remove ${line.name}`}
                  icon={<DeleteOutlined />}
                  onClick={() => void remove(line.productId)}
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
            id="checkout-form"
            className="mp-checkout-form"
          >
            {/* A stranger's one extra fact: how they find the order again.
                A signed-in buyer has an account for that. */}
            {commerce.guest && (
              <>
                <h2>Your email</h2>
                <Form.Item
                  name="email"
                  label="Email"
                  extra="No account needed. Keep this with your order number to find the order later."
                  rules={[{ required: true, type: 'email', message: 'An email address, so you can find your order again' }]}
                >
                  <Input placeholder="you@example.com" autoComplete="email" />
                </Form.Item>
              </>
            )}
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
              {formatPrice(total, currency)}
            </span>
          </div>
          <div className="mp-summary-row mp-summary-total">
            <span>Total</span>
            <span className="mp-num">
              {formatPrice(total, currency)}
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
            Checkout
          </Button>
        </aside>
      </div>
    </>
  );
}
