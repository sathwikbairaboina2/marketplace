'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Select } from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import { useAuth } from '../../lib/auth/auth-context';

interface Persona {
  username: string;
  password: string;
}

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [form] = Form.useForm();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/personas')
      .then((r) => r.json())
      .then((body: { personas: Persona[] }) => setPersonas(body.personas))
      .catch(() => setPersonas([]));
  }, []);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await signIn(values.username, values.password);
      router.push('/products');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-auth">
      <span className="mp-auth-brand">
        <span className="mp-mark" aria-hidden="true">
          <TagsOutlined />
        </span>
        Marketplace
      </span>

      <Card title="Sign in" className="mp-auth-card">
        {personas.length > 0 && (
          <Select
            data-testid="persona"
            // A placeholder is not a label: it disappears on selection and axe
            // reports the control as unlabelled either way.
            aria-label="Demo persona"
            style={{ width: '100%', marginBottom: 16 }}
            placeholder="Pick a demo persona"
            options={personas.map((p) => ({ value: p.username, label: p.username }))}
            onChange={(username: string) => {
              const persona = personas.find((p) => p.username === username);
              if (persona) form.setFieldsValue(persona);
            }}
          />
        )}
        {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="username" label="Username" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} block>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
