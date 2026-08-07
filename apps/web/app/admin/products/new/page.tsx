'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Form, Input, InputNumber, Select, message } from 'antd';
import { ImageUploader } from '../../../../components/image-uploader';
import { createProduct } from '../../../../lib/api/products';
import { toAttributes, toFormItems } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { notifyProblem, toFormErrors } from '../../../../lib/problem-notify';

export default function NewProductPage() {
  const schema = useSchema('Product');
  const router = useRouter();
  const [form] = Form.useForm();
  // Held outside the Form: each file is uploaded as it is chosen, so by submit
  // time these are already stored objects rather than pending form state. The
  // engine has no update routes, so this is the only moment a product's images
  // can be set.
  const [images, setImages] = useState<string[]>([]);

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createProduct({
        name: values.name as string,
        description: values.description as string,
        priceMinor: values.priceMinor as number,
        currency: values.currency as string,
        category: values.category as string,
        stock: values.stock as number,
        images,
        status: values.status as 'active' | 'draft' | 'archived' | 'out_of_stock',
        attributes: toAttributes(
          schema?.fields ?? {},
          (values.attributes ?? {}) as Record<string, unknown>,
        ),
      });
      void message.success('Product created');
      router.push(`/products/${created.id}`);
    } catch (err) {
      // A 400 from ZodValidationPipe carries errors[] with field paths; putting
      // them on the fields beats a toast the user has to map back by hand.
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <Card title="New product" style={{ maxWidth: 640 }}>
      <Form
        form={form}
        layout="vertical"
        onFinish={submit}
        initialValues={{ currency: 'USD', stock: 0, status: 'active' }}
      >
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="Description" rules={[{ required: true }]}>
          <Input.TextArea />
        </Form.Item>
        <Form.Item name="category" label="Category" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="priceMinor" label="Price (minor units)" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
          <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
        </Form.Item>
        <Form.Item name="stock" label="Stock" rules={[{ required: true }]}>
          <InputNumber min={0} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="status" label="Status" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'active' },
              { value: 'draft' },
              { value: 'archived' },
              { value: 'out_of_stock' },
            ]}
          />
        </Form.Item>
        <Form.Item label="Images">
          <ImageUploader value={images} onChange={setImages} />
        </Form.Item>
        {/* The tenant's dynamic fields, generated from the registry. */}
        {schema ? toFormItems(schema.fields) : null}
        <Button type="primary" htmlType="submit">
          Create
        </Button>
      </Form>
    </Card>
  );
}
