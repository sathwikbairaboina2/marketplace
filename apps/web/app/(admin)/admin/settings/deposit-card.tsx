'use client';

import { useEffect } from 'react';
import { Button, Card, Form, InputNumber, Switch, message } from 'antd';
import { DEFAULT_DEPOSIT_POLICY, type DepositPolicy } from '@marketplace/contracts';
import { getDepositPolicy, putDepositPolicy } from '../../../../lib/api/settings';
import { notifyProblem, toFormErrors } from '../../../../lib/problem-notify';

/**
 * Whether the shop takes part of the money now and the rest in the room.
 *
 * Deliberately not a payment feature: the order is paid in full for the
 * deposit, the remainder is recorded against it, and the merchant collects it
 * on the QR code she already uses. Nothing here moves money.
 */
export function DepositCard() {
  const [form] = Form.useForm();

  useEffect(() => {
    getDepositPolicy()
      .then((policy) => {
        // Field by field, and only where the seller has not started typing --
        // the same reason the announcement form does it. `minOrder` is in
        // rupees where the record is in minor units, so it is mapped rather
        // than copied: looping over the record's own keys would have set a
        // field called `minOrderMinor` that this form does not have.
        if (!form.isFieldTouched('enabled')) form.setFieldValue('enabled', policy.enabled);
        if (!form.isFieldTouched('percent')) form.setFieldValue('percent', policy.percent);
        if (!form.isFieldTouched('minOrder')) {
          form.setFieldValue('minOrder', policy.minOrderMinor / 100);
        }
      })
      .catch(notifyProblem);
  }, [form]);

  const submit = async (values: Record<string, unknown>) => {
    try {
      await putDepositPolicy({
        enabled: Boolean(values.enabled),
        percent: Number(values.percent),
        // Rupees in the form, minor units on the wire.
        minOrderMinor: Math.round(Number(values.minOrder ?? 0) * 100),
      } as DepositPolicy);
      void message.success('Deposit settings saved');
    } catch (err) {
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <Card className="mp-form-card" title="Deposits">
      <p style={{ marginTop: 0, color: 'var(--mp-muted)' }}>
        Let a customer pay part now and the rest when they collect or take delivery. You collect
        the balance yourself and mark it settled on the order.
      </p>
      <Form
        form={form}
        // Namespaces this form's field ids. Three forms share this page, and
        // two of them had a field called `enabled`: both switches rendered
        // `id="enabled"`, so the announcement's label pointed at the deposit
        // switch -- whose accessible name became "Offer a deposit Show it".
        name="deposit"
        layout="vertical"
        onFinish={submit}
        initialValues={{
          ...DEFAULT_DEPOSIT_POLICY,
          minOrder: DEFAULT_DEPOSIT_POLICY.minOrderMinor / 100,
        }}
      >
        <Form.Item name="enabled" label="Offer a deposit" valuePropName="checked">
          <Switch />
        </Form.Item>
        <div className="mp-field-row">
          <Form.Item
            name="percent"
            label="Paid up front"
            extra="Per cent of the order taken at checkout."
            rules={[{ required: true }]}
          >
            <InputNumber min={10} max={90} addonAfter="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="minOrder"
            label="Only on orders over"
            extra="Below this, the customer pays in full."
            rules={[{ required: true }]}
          >
            <InputNumber min={0} step={100} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Button type="primary" htmlType="submit">
          Save deposit settings
        </Button>
      </Form>
    </Card>
  );
}
