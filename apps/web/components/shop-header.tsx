'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, Button, Space, Tag } from 'antd';
import { useAuth } from '../lib/auth/auth-context';
import { useCart } from '../lib/cart/cart-context';
import { ThemeToggle } from './theme-toggle';

// These accessible names are a contract: auth.spec.ts asserts a buyer sees
// links named exactly `Products` and `Orders`, and none named `Flows` or
// `Chat`. Renaming any of them breaks the regression net.
const LINKS = [
  { href: '/products', label: 'Products' },
  { href: '/events', label: 'Events' },
  { href: '/orders', label: 'Orders' },
  { href: '/bookings', label: 'Bookings' },
];

export function ShopHeader() {
  const { principal, signOut } = useAuth();
  const { lines } = useCart();
  const pathname = usePathname();

  return (
    <header className="mp-shop-header">
      <Link href="/products" className="mp-shop-brand">
        {principal?.tenantId}
      </Link>

      <nav className="mp-shop-nav">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} data-active={pathname.startsWith(l.href) || undefined}>
            {l.label}
          </Link>
        ))}
        {/* Deliberately not named Flows or Chat -- auth.spec asserts a buyer
            sees neither, and this entry is admin-only regardless. */}
        {principal?.role === 'admin' && <Link href="/admin/flows">Admin</Link>}
      </nav>

      <Space size="small">
        <Link href="/cart" aria-label="Cart">
          <Badge count={lines.length} size="small">
            <Button>Cart</Button>
          </Badge>
        </Link>
        {/* The tenant is the brand on the left and is deliberately not repeated
            here -- one header showing `acme` twice is noise, and it made
            `getByText('acme', { exact: true })` ambiguous. Role has no other
            home in this shell, so it stays. */}
        <Tag>{principal?.role ?? 'no role'}</Tag>
        <ThemeToggle />
        <Button size="small" onClick={signOut}>
          Sign out
        </Button>
      </Space>
    </header>
  );
}
