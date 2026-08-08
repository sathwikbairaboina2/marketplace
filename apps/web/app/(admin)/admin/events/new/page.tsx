'use client';

import { useRouter } from 'next/navigation';
import { Button, Card, DatePicker, Form, Input, InputNumber, Select, message } from 'antd';
import type { Dayjs } from 'dayjs';
import { createEvent } from '../../../../../lib/api/events';
import { toAttributes, toFormItems } from '../../../../../lib/schema-fields';
import { useSchema } from '../../../../../lib/schemas/schema-cache';
import { PageHeader } from '../../../../../components/page-header';
import { notifyProblem, toFormErrors } from '../../../../../lib/problem-notify';

export default function NewEventPage() {
  const schema = useSchema('Event');
  const router = useRouter();
  const [form] = Form.useForm();

  const submit = async (values: Record<string, unknown>) => {
    try {
      const created = await createEvent({
        title: values.title as string,
        capacity: values.capacity as number,
        // IsoDateTimeSchema is z.string().datetime(); DatePicker yields Dayjs.
        startDate: (values.startDate as Dayjs).toISOString(),
        endDate: (values.endDate as Dayjs).toISOString(),
        basePriceMinor: values.basePriceMinor as number,
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
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ currency: 'USD' }}>
          <Form.Item name="title" label="Title" rules={[{ required: true }]}>
            <Input />
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
            <Form.Item
              name="basePriceMinor"
              label="Base price (minor units)"
              rules={[{ required: true }]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="currency" label="Currency" rules={[{ required: true }]}>
              <Select options={[{ value: 'USD' }, { value: 'EUR' }, { value: 'GBP' }]} />
            </Form.Item>
            <Form.Item name="capacity" label="Capacity" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          {schema ? toFormItems(schema.fields) : null}
          <Button type="primary" htmlType="submit">
            Create
          </Button>
        </Form>
      </Card>
    </>
  );
}
