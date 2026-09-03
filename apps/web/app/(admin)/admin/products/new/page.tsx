'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AutoComplete, Button, Card, Form, Input, InputNumber, Select, message } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import { ImageUploader } from '../../../../../components/image-uploader';
import { createProduct } from '../../../../../lib/api/products';
import { draftCopy } from '../../../../../lib/api/agents';
import { toAttributes, toFormItems } from '../../../../../lib/schema-fields';
import { useSchema } from '../../../../../lib/schemas/schema-cache';
import { PageHeader } from '../../../../../components/page-header';
import { useStorefrontCategories } from '../../../../../lib/storefront-categories';
import { notifyProblem, toFormErrors } from '../../../../../lib/problem-notify';

export default function NewProductPage() {
  const schema = useSchema('Product');
  const router = useRouter();
  const [form] = Form.useForm();
  const categorySuggestions = useStorefrontCategories();
  // Held outside the Form: each file is uploaded as it is chosen, so by submit
  // time these are already stored objects rather than pending form state. The
  // engine has no update routes, so this is the only moment a product's images
  // can be set.
  const [images, setImages] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);

  // One-shot: the model writes into the same editable field the seller types
  // into, and nothing is saved until they hit Create.
  const draftDescription = async () => {
    const name = ((form.getFieldValue('name') as string | undefined) ?? '').trim();
    const category = ((form.getFieldValue('category') as string | undefined) ?? '').trim();
    if (!name || !category) {
      void message.warning('Give the product a name and a category first');
      return;
    }
    setDrafting(true);
    try {
      const { description } = await draftCopy({ name, category });
      form.setFieldValue('description', description);
    } catch (err) {
      notifyProblem(err);
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createProduct({
        name: values.name as string,
        description: values.description as string,
        // The engine speaks minor units; people don't. Convert at the boundary,
        // exactly as the storefront filter rail already does.
        priceMinor: Math.round((values.price as number) * 100),
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
    <>
      <PageHeader title="New product" subtitle="Photos, price and stock can all be changed after the product is listed." />
      <Card className="mp-form-card">
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ currency: 'USD', stock: 0, status: 'active' }}
        >
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="description"
            label="Description"
            rules={[{ required: true }]}
            extra={
              <Button
                size="small"
                icon={<ThunderboltOutlined />}
                loading={drafting}
                onClick={() => void draftDescription()}
                data-testid="draft-description"
                style={{ marginTop: 8 }}
              >
                Draft with AI
              </Button>
            }
          >
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} />
          </Form.Item>
          <Form.Item name="category" label="Category" rules={[{ required: true }]}>
            {/* Suggestions, not a closed list: the shop's own categories are
                offered, and anything else the seller types is still valid. */}
            <AutoComplete
              options={categorySuggestions.map((c) => ({ value: c }))}
              filterOption={(input, option) =>
                String(option?.value ?? '')
                  .toLowerCase()
                  .includes(input.toLowerCase())
              }
            />
          </Form.Item>
          {/* Price, currency, stock and status are each a few characters wide.
              One per row turned a seven-field form into a page of scrolling. */}
          <div className="mp-field-row">
            <Form.Item name="price" label="Price" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
              <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
            </Form.Item>
          </div>
          <div className="mp-field-row">
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
          </div>
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
    </>
  );
}
