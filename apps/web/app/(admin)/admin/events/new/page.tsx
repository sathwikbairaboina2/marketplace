'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, DatePicker, Form, Input, InputNumber, Select, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { createEvent } from '../../../../../lib/api/events';
import { toAttributes, toFormItems } from '../../../../../lib/schema-fields';
import { useSchema } from '../../../../../lib/schemas/schema-cache';
import { ImageUploader } from '../../../../../components/image-uploader';
import { PageHeader } from '../../../../../components/page-header';
import { notifyProblem, toFormErrors } from '../../../../../lib/problem-notify';
import { DEFAULT_CURRENCY, currencyOptions } from '../../../../../lib/format';

export default function NewEventPage() {
  const schema = useSchema('Event');
  const router = useRouter();
  const [form] = Form.useForm();
  const [images, setImages] = useState<string[]>([]);

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createEvent({
        title: values.title as string,
        capacity: values.capacity as number,
        description: (values.description as string | undefined)?.trim() || undefined,
        location: (values.location as string | undefined)?.trim() || undefined,
        images,
        // IsoDateTimeSchema is z.string().datetime(); DatePicker yields Dayjs.
        startDate: (values.startDate as Dayjs).toISOString(),
        endDate: (values.endDate as Dayjs).toISOString(),
        // The engine speaks minor units; people don't. Convert at the boundary.
        basePriceMinor: Math.round((values.basePrice as number) * 100),
        currency: values.currency as string,
        attributes: toAttributes(
          schema?.fields ?? {},
          (values.attributes ?? {}) as Record<string, unknown>,
        ),
      });
      void message.success('Event created');
      router.push(`/events/${created.id}`);
    } catch (err) {
      // CreateEventSchema refines that endDate must be after startDate, and the
      // refinement sets path: ['endDate'] -- so this lands on the field rather
      // than in a toast the user has to map back by hand.
      const fieldErrors = toFormErrors(err);
      if (fieldErrors.length) form.setFields(fieldErrors);
      else notifyProblem(err);
    }
  };

  return (
    <>
      <PageHeader title="New event" subtitle="Capacity is enforced transactionally when tickets are booked." />
      <Card className="mp-form-card">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ currency: DEFAULT_CURRENCY }}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          {/* A class is a place you go to and a thing you do. The storefront
              showed neither, because until now an event could not carry
              either. */}
          <Form.Item
            name="description"
            label="What happens"
            extra="What a customer does, what is provided, what they take home."
          >
            <Input.TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
          <Form.Item name="location" label="Where" extra="The address a customer travels to.">
            <Input maxLength={200} placeholder="12 Karve Road, Kothrud, Pune" />
          </Form.Item>
          {/* Start and end belong to one decision, and so do price and
              currency. Pairing them keeps the form to one screen. */}
          <div className="mp-field-row">
            <Form.Item name="startDate" label="Starts" rules={[{ required: true }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="endDate" label="Ends" rules={[{ required: true }]}>
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <div className="mp-field-row">
            <Form.Item name="basePrice" label="Base price" rules={[{ required: true }]}>
              <InputNumber min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
              <Select options={currencyOptions} />
            </Form.Item>
            <Form.Item name="capacity" label="Capacity" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item label="Photographs">
            <ImageUploader value={images} onChange={setImages} />
          </Form.Item>
          {schema ? toFormItems(schema.fields) : null}
          <Button type="primary" htmlType="submit">
            Create
          </Button>
        </Form>
      </Card>
    </>
  );
}
