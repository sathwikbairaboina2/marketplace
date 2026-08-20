'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button, Card, Form, Input, Switch, message } from 'antd';
import { getAnnouncement, putAnnouncement } from '../../../../lib/api/settings';
import { PageHeader } from '../../../../components/page-header';
import { notifyProblem } from '../../../../lib/problem-notify';
import { StageEditor } from './stage-editor';

export default function AdminSettingsPage() {
  const [form] = Form.useForm();

  useEffect(() => {
    getAnnouncement()
      .then((a) => {
        // Field by field, and only where the seller has not already typed. A
        // cold stack can take seconds to answer, and `setFieldsValue(a)` landing
        // after someone has started writing replaced their sentence with the
        // stored one -- silently, and with the toggle left on, so Save then
        // published an empty announcement.
        if (!form.isFieldTouched('text')) form.setFieldValue('text', a.text);
        if (!form.isFieldTouched('enabled')) form.setFieldValue('enabled', a.enabled);
      })
      .catch(notifyProblem);
  }, [form]);

  const submit = async (values: { text?: string; enabled?: boolean }) => {
    try {
      await putAnnouncement({ text: values.text ?? '', enabled: values.enabled ?? false });
      void message.success('Announcement saved');
    } catch (err) {
      notifyProblem(err);
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="What your shop says for itself." />
      <Card className="mp-form-card" title="Store design">
        <p style={{ marginTop: 0, color: 'var(--mp-muted)' }}>
          Theme, About page and banners — drafted with the assistant, published when you say so.
        </p>
        <Link href="/admin/onboarding">
          <Button>Open store designer</Button>
        </Link>
      </Card>
      <StageEditor />
      <Card className="mp-form-card" title="Announcement">
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ text: '', enabled: false }}
        >
          <Form.Item
            name="text"
            label="Announcement"
            extra="One line above your shop — a promotion, a holiday notice, anything current."
            rules={[{ max: 140 }]}
          >
            <Input maxLength={140} placeholder="Launch week — 10% off until Friday" />
          </Form.Item>
          <Form.Item name="enabled" label="Show it" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Save
          </Button>
        </Form>
      </Card>
    </>
  );
}
