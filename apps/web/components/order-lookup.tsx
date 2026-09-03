'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Form, Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
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
          const id = values.orderId.trim().toUpperCase();
          router.push(`/orders/${encodeURIComponent(id)}?email=${encodeURIComponent(values.email.trim())}`);
        }}
      >
        <Form.Item
          name="orderId"
          label="Order number"
          rules={[{ required: true, len: 26, message: 'The 26-character order number from your confirmation' }]}
        >
          <Input placeholder="01M1KEV444FHX3DYK6NJA8Y24P" autoComplete="off" />
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
