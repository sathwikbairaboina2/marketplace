'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from 'antd';
import { useAuth } from '../lib/auth/auth-context';
import { ThemeToggle } from './theme-toggle';

const GROUPS = [
  {
    label: 'Catalogue',
    items: [
      { href: '/admin/products', label: 'Products' },
      { href: '/admin/events', label: 'Events' },
      { href: '/admin/products/new', label: 'New product' },
      { href: '/admin/events/new', label: 'New event' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/orders', label: 'Orders' },
      { href: '/bookings', label: 'Bookings' },
    ],
  },
  {
    label: 'Schema',
    items: [
      { href: '/admin/flows', label: 'Flows' },
      { href: '/admin/chat', label: 'Chat' },
    ],
  },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { principal, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <div className="mp-sidebar">
      <Link href="/products" className="mp-sidebar-brand" onClick={onNavigate}>
        Marketplace
      </Link>

      <nav className="mp-sidebar-nav">
        {GROUPS.map((group) => (
          <div key={group.label} className="mp-sidebar-group">
            <div className="mp-sidebar-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                data-active={pathname === item.href || undefined}
              >
                {item.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* The tenant carries real visual weight here. Moving identity out of a
          top bar cost it prominence, and switching between acme and globex is
          how tenant isolation is demonstrated -- it has to land somewhere the
          eye actually goes. */}
      <div className="mp-sidebar-foot">
        <div className="mp-sidebar-tenant">{principal?.tenantId}</div>
        <div className="mp-sidebar-role">{principal?.role ?? 'no role'}</div>
        <div className="mp-sidebar-actions">
          <ThemeToggle />
          <Button size="small" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
