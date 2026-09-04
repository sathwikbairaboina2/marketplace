'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Form, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { normalizeOrderReference, ORDER_REFERENCE_PATTERN } from '@marketplace/contracts';
import { PageHeader } from './page-header';

/**
 * What /orders is to a stranger: not a list -- they have none -- but the way
 * back to the one order they placed, with the two things the confirmation
 * page told them to keep. The order page does the lookup; this only asks.
 */
export function OrderLookup() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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
    </>
  );
}
