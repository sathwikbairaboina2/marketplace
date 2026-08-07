'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Empty, Form, Input, InputNumber, Select, Table, message } from 'antd';
import { createOrder } from '../../lib/api/orders';
import { useCart, type CartLine } from '../../lib/cart/cart-context';
import { ProblemError } from '../../lib/api/http';
import { notifyProblem } from '../../lib/problem-notify';
import { toAttributes, toFormItems } from '../../lib/schema-fields';
import { useSchema } from '../../lib/schemas/schema-cache';

const BACKOFFS_MS = [500, 1000, 2000, 4000, 8000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function CartPage() {
  const { lines, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  const schema = useSchema('Order');
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  if (!lines.length) return <Empty description="Your cart is empty" />;

  const total = lines.reduce((sum, l) => sum + l.priceMinor * l.qty, 0);

  return (
    <Card title="Cart" style={{ maxWidth: 720 }}>
      <Table<CartLine>
        rowKey="productId"
        pagination={false}
        dataSource={lines}
        columns={[
          { title: 'Product', dataIndex: 'name' },
          {
            title: 'Qty',
            dataIndex: 'qty',
            render: (qty: number, row) => (
              <InputNumber min={1} value={qty} onChange={(v) => setQty(row.productId, v ?? 1)} />
            ),
          },
          {
            title: 'Line total',
            render: (_, row) => ((row.priceMinor * row.qty) / 100).toFixed(2),
          },
          {
            title: '',
            render: (_, row) => <Button onClick={() => remove(row.productId)}>Remove</Button>,
          },
        ]}
      />
      {/* Indicative only. POST /orders locks unit prices server-side at order
          time, so a stale cached price is a display concern, never a
          correctness one. */}
      <p style={{ marginTop: 12 }}>Estimated total: {(total / 100).toFixed(2)}</p>

      <Form
        layout="vertical"
        onFinish={submit}
        initialValues={{ currency: 'USD' }}
        style={{ marginTop: 24 }}
      >
        <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
          <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
        </Form.Item>
        <Form.Item name="line1" label="Address" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="city" label="City" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="postcode" label="Postcode" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        {schema ? toFormItems(schema.fields) : null}
        <Button type="primary" htmlType="submit" loading={busy} disabled={busy}>
          Place order
        </Button>
      </Form>
    </Card>
  );
}
