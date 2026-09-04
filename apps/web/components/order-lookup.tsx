'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Form, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { normalizeOrderReference, ORDER_REFERENCE_PATTERN } from '@marketplace/contracts';
import type { OrderResponse } from '@marketplace/contracts';
import { guestOrderHistory } from '../lib/api/shop';
import { useShop } from '../lib/shop/shop-context';
import { formatDate, formatPrice } from '../lib/format';
import { notifyProblem } from '../lib/problem-notify';
import { PageHeader } from './page-header';

/**
 * What /orders is to a stranger: not a list -- they have none -- but the way
 * back to the one order they placed, with the two things the confirmation
 * page told them to keep. The order page does the lookup; this only asks.
 */
export function OrderLookup() {
  const router = useRouter();
  const shop = useShop();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<OrderResponse[] | null>(null);
  const [finding, setFinding] = useState(false);

  // A customer who kept the email but not the order number. Seventy per cent
  // of this merchant's money is repeat business, and before this a returning
  // customer had to produce a 26-character id from months ago.
  const findAll = async (email: string) => {
    if (!shop || !email.trim()) return;
    setFinding(true);
    try {
      setHistory(await guestOrderHistory(shop.tenantId, email.trim()));
    } catch (err) {
      notifyProblem(err);
    } finally {
      setFinding(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Find your order"
        subtitle="Enter the order number from your confirmation and the email you gave at checkout."
      />
      <Form
        layout="vertical"
        className="mp-checkout-form mp-list-measure"
        onFinish={(values: { orderId: string; email: string }) => {
          setBusy(true);
          // Either the short reference the confirmation prints or the full id
          // a shopper bookmarked. Normalising here means a missing dash, a
          // lowercase letter, or an `O` typed for a `0` still finds the order.
          const typed = values.orderId.trim();
          const reference = normalizeOrderReference(typed);
          const id = ORDER_REFERENCE_PATTERN.test(reference) ? reference : typed.toUpperCase();
          router.push(`/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(values.email.trim())}`);
        }}
      >
        <Form.Item
          name="orderId"
          label="Order number"
          rules={[
            { required: true },
            {
              validator: (_, value: string) => {
                const typed = String(value ?? '').trim();
                if (!typed) return Promise.resolve();
                const ok =
                  ORDER_REFERENCE_PATTERN.test(normalizeOrderReference(typed)) ||
                  typed.length === 26;
                return ok
                  ? Promise.resolve()
                  : Promise.reject(new Error('The order number from your confirmation, like K7QY-3PX2'));
              },
            },
          ]}
        >
          <Input placeholder="K7QY-3PX2" autoComplete="off" />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
          <Input placeholder="you@example.com" autoComplete="email" />
        </Form.Item>
        <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={busy}>
          Find order
        </Button>
      </Form>

      {shop && (
        <div className="mp-list-measure" style={{ marginTop: 'var(--mp-space-8)' }}>
          <h2 className="mp-lookup-heading">Lost the number?</h2>
          <p style={{ color: 'var(--mp-muted)' }}>
            Enter the email you used and we will list everything you have ordered here.
          </p>
          <Input.Search
            allowClear
            type="email"
            placeholder="you@example.com"
            enterButton="List my orders"
            loading={finding}
            onSearch={(value) => void findAll(value)}
            style={{ maxWidth: 380 }}
          />

          {history !== null &&
            (history.length === 0 ? (
              <p style={{ marginTop: 'var(--mp-space-4)', color: 'var(--mp-muted)' }}>
                Nothing has been ordered with that address here.
              </p>
            ) : (
              <ul className="mp-history">
                {history.map((order) => (
                  <li key={order.id}>
                    <Link href={`/orders/${order.id}`}>
                      <strong className="mp-num">{order.reference}</strong>
                    </Link>
                    <span className="mp-sub">
                      {formatDate(order.createdAt)} ·{' '}
                      {formatPrice(order.totalAmountMinor, order.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}
    </>
  );
}
