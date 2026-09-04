'use client';

import { useEffect } from 'react';
import { Button, Card, Form, Input, message } from 'antd';
import { EMPTY_SHOP_CONTACT, type ShopContact } from '@marketplace/contracts';
import { getShopContact, putShopContact } from '../../../../lib/api/settings';
import { notifyProblem, toFormErrors } from '../../../../lib/problem-notify';

/**
 * What the shop's footer prints. Every field is optional and an empty one
 * shows nothing: a delivery promise the merchant has not made is worse than a
 * blank space.
 */
export function ShopContactCard() {
  // Untyped, like the other forms here: the field names are already pinned by
  // EMPTY_SHOP_CONTACT and antd's generic makes the loop below unassignable.
  const [form] = Form.useForm();

  useEffect(() => {
    getShopContact()
      .then((contact) => {
        // Field by field, and only where the seller has not started typing --
        // the same reason the announcement form does it: a slow answer must
        // not overwrite a sentence someone is part-way through.
        for (const [key, value] of Object.entries(contact)) {
          if (!form.isFieldTouched(key)) form.setFieldValue(key, value);
        }
      })
      .catch(notifyProblem);
  }, [form]);

  const submit = async (values: Partial<ShopContact>) => {
    try {
      await putShopContact({ ...EMPTY_SHOP_CONTACT, ...values });
      void message.success('Contact details saved');
    } catch (err) {
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <Card className="mp-form-card" title="Contact and delivery">
      <p style={{ marginTop: 0, color: 'var(--mp-muted)' }}>
        Printed at the bottom of every page of your shop. Leave anything blank and it is not
        shown.
      </p>
      <Form
        form={form}
        name="contact"
        layout="vertical"
        onFinish={submit}
        initialValues={EMPTY_SHOP_CONTACT}
      >
        <div className="mp-field-row">
          <Form.Item name="phone" label="Phone">
            <Input placeholder="+91 98765 43210" />
          </Form.Item>
          <Form.Item name="whatsapp" label="WhatsApp">
            <Input placeholder="+91 98765 43210" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ type: 'email' }]}>
            <Input placeholder="hello@yourshop.in" />
          </Form.Item>
        </div>
        <Form.Item name="address" label="Address">
          <Input.TextArea rows={2} maxLength={300} placeholder="12 Karve Road, Kothrud, Pune 411004" />
        </Form.Item>
        <Form.Item
          name="delivery"
          label="Delivery"
          extra="How and when things reach a customer."
        >
          <Input.TextArea rows={2} maxLength={280} placeholder="Posted within 3 working days across India. Collection from the studio by arrangement." />
        </Form.Item>
        <Form.Item name="returns" label="Returns" extra="What happens if something arrives broken.">
          <Input.TextArea rows={2} maxLength={280} placeholder="Tell us within 7 days and we will replace or refund." />
        </Form.Item>
        {/* Named, not just "Save": this page now has two forms on it, and a
            bare Save on each says nothing about which one it belongs to. */}
        <Button type="primary" htmlType="submit">
          Save contact details
        </Button>
      </Form>
    </Card>
  );
}
