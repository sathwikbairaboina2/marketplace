'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  CalendarOutlined,
  CommentOutlined,
  LogoutOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  ProfileOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { useAuth } from '../lib/auth/auth-context';
import { ThemeToggle } from './theme-toggle';

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: 'Catalogue',
    items: [
      { href: '/admin/products', label: 'Products', icon: <AppstoreOutlined /> },
      { href: '/admin/events', label: 'Events', icon: <CalendarOutlined /> },
      { href: '/admin/products/new', label: 'New product', icon: <PlusOutlined /> },
      { href: '/admin/events/new', label: 'New event', icon: <PlusOutlined /> },
    ],
  },
  {
    label: 'Sales',
    items: [
      { href: '/orders', label: 'Orders', icon: <ShoppingCartOutlined /> },
      { href: '/bookings', label: 'Bookings', icon: <ProfileOutlined /> },
    ],
  },
  {
    label: 'Schema',
    items: [
      { href: '/admin/flows', label: 'Flows', icon: <NodeIndexOutlined /> },
      { href: '/admin/chat', label: 'Chat', icon: <CommentOutlined /> },
    ],
  },
];

export function AdminSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { principal, signOut } = useAuth();
  const pathname = usePathname();

  return (
    <div className="mp-sidebar">
      <Link href="/products" className="mp-sidebar-brand" onClick={onNavigate}>
        <span className="mp-mark" aria-hidden="true">
          <TagsOutlined />
        </span>
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
                {item.icon}
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
        <div className="mp-sidebar-tenant">
          <span className="mp-mark" aria-hidden="true">
            {(principal?.tenantId ?? '?').charAt(0).toUpperCase()}
          </span>
          {principal?.tenantId}
        </div>
        <div className="mp-sidebar-role">{principal?.role ?? 'no role'}</div>
        <div className="mp-sidebar-actions">
          <ThemeToggle />
          <Tooltip title="Sign out">
            <Button size="small" icon={<LogoutOutlined />} onClick={signOut}>
              Sign out
            </Button>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
