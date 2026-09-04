'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Alert, Button, Card, Form, Input, Select } from 'antd';
import { TagsOutlined } from '@ant-design/icons';
import { useAuth } from '../../lib/auth/auth-context';

interface Persona {
  username: string;
  password: string;
}

/**
 * Where to go once signed in. A same-origin path only: `next` arrives in the
 * URL and an absolute one would make this page an open redirect.
 */
function landingFrom(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/products';
}

function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const landing = landingFrom(params.get('next'));
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
      // The cart built as a stranger comes along, but not from here: the
      // sign-in flips the cart's binding, and a merge fired beside that
      // rebind races the refetch it is supposed to precede. CartProvider
      // adopts the ticket in front of its first read instead.
      router.push(landing);
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

// useSearchParams needs a Suspense boundary above it or `next build` refuses
// to prerender the page.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
