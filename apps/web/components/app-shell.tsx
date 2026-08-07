'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Layout, Menu, Space, Tag } from 'antd';
import { useAuth } from '../lib/auth/auth-context';
import { onUnauthorized } from '../lib/api/http';

const BUYER_ITEMS = [
  { key: '/products', label: <Link href="/products">Products</Link> },
  { key: '/events', label: <Link href="/events">Events</Link> },
  { key: '/cart', label: <Link href="/cart">Cart</Link> },
  { key: '/orders', label: <Link href="/orders">Orders</Link> },
  { key: '/bookings', label: <Link href="/bookings">Bookings</Link> },
];

const ADMIN_ITEMS = [
  { key: '/admin/products/new', label: <Link href="/admin/products/new">New product</Link> },
  { key: '/admin/events/new', label: <Link href="/admin/events/new">New event</Link> },
  { key: '/admin/flows', label: <Link href="/admin/flows">Flows</Link> },
  { key: '/admin/chat', label: <Link href="/admin/chat">Chat</Link> },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { principal, ready, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  useEffect(() => {
    if (ready && !principal && pathname !== '/login') router.push('/login');
  }, [ready, principal, pathname, router]);

  if (pathname === '/login') return <>{children}</>;
  if (!ready || !principal) return null;

  // Admins get the buyer views too -- they browse their own catalogue.
  //
  // This is navigation, not authorization. The engine enforces tenant isolation
  // on every route and enforces nothing whatsoever about role, so an admin URL
  // typed by hand works perfectly well for a buyer. packages/contracts/src/flow.ts
  // says so outright about the most consequential route here: any authenticated
  // member of the tenant may propose or execute a flow.
  const items = principal.role === 'admin' ? [...BUYER_ITEMS, ...ADMIN_ITEMS] : BUYER_ITEMS;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[pathname]}
          items={items}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space>
          <Tag color="blue">{principal.tenantId}</Tag>
          <Tag>{principal.role ?? 'no role'}</Tag>
          <Button size="small" onClick={signOut}>
            Sign out
          </Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
    </Layout>
  );
}
