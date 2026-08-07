'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, Button, Space, Tag } from 'antd';
import {
  AppstoreOutlined,
  CalendarOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useAuth } from '../lib/auth/auth-context';
import { useCart } from '../lib/cart/cart-context';
import { ThemeToggle } from './theme-toggle';

// These accessible names are a contract: auth.spec.ts asserts a buyer sees
// links named exactly `Products` and `Orders`, and none named `Flows` or
// `Chat`. Renaming any of them breaks the regression net.
const LINKS = [
  { href: '/products', label: 'Products', icon: <AppstoreOutlined /> },
  { href: '/events', label: 'Events', icon: <CalendarOutlined /> },
  { href: '/orders', label: 'Orders', icon: <ShoppingOutlined /> },
  { href: '/bookings', label: 'Bookings', icon: <ProfileOutlined /> },
];

export function ShopHeader() {
  const { principal, signOut } = useAuth();
  const { lines } = useCart();
  const pathname = usePathname();

  return (
    <header className="mp-shop-header">
      {/* A wordmark, not the tenant. The storefront hero announces the tenant
          in full, and showing it in both places made `acme` ambiguous on the
          page as well as redundant to read. */}
      <Link href="/products" className="mp-shop-brand">
        <span className="mp-mark" aria-hidden="true">
          <TagsOutlined />
        </span>
        Marketplace
      </Link>

      <nav className="mp-shop-nav">
        {LINKS.map((l) => {
          const active = pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              data-active={active || undefined}
            >
              {l.icon}
              {l.label}
            </Link>
          );
        })}
        {/* Deliberately not named Flows or Chat -- auth.spec asserts a buyer
            sees neither, and this entry is admin-only regardless. */}
        {principal?.role === 'admin' && (
          <Link href="/admin/products">
            <SettingOutlined />
            Admin
          </Link>
        )}
      </nav>

      <Space size="small">
        <Link href="/cart" aria-label="Cart">
          <Badge count={lines.length} size="small" offset={[-2, 2]}>
            <Button icon={<ShoppingCartOutlined />}>Cart</Button>
          </Badge>
        </Link>
        <Tag bordered={false}>{principal?.role ?? 'no role'}</Tag>
        <ThemeToggle />
        <Button size="small" icon={<LogoutOutlined />} onClick={signOut}>
          Sign out
        </Button>
      </Space>
    </header>
  );
}
