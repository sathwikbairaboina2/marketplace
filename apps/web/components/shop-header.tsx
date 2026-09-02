'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, Button, Grid, Space } from 'antd';
import {
  AppstoreOutlined,
  CalendarOutlined,
  LoginOutlined,
  LogoutOutlined,
  ProfileOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import { useAuth } from '../lib/auth/auth-context';
import { useCart } from '../lib/cart/cart-context';
import { useStorefrontConfig } from '../lib/storefront-config';
import { ThemeToggle } from './theme-toggle';

// These accessible names are a contract: auth.spec.ts asserts a buyer sees
// links named exactly `Products` and `Orders`, and none named `Flows` or
// `Chat`. Renaming any of them breaks the regression net.
const PRODUCTS_LINK = { href: '/products', label: 'Products', icon: <AppstoreOutlined /> };
const EVENTS_LINK = { href: '/events', label: 'Events', icon: <CalendarOutlined /> };
// What anyone may browse, and what only a signed-in buyer has.
const BROWSE = [PRODUCTS_LINK, EVENTS_LINK];
const SESSION = [
  { href: '/orders', label: 'Orders', icon: <ShoppingOutlined /> },
  { href: '/bookings', label: 'Bookings', icon: <ProfileOutlined /> },
];

/**
 * A shop whose customers book a place rather than buy a thing leads with
 * Events. Every other shop -- including every one published before
 * `sellsWhat` existed -- keeps Products first.
 *
 * Order only: the labels stay exactly as they are, because auth.spec.ts
 * asserts on them by name. A stranger sees the browse links and nothing that
 * would only ever show them a login page.
 */
function orderedLinks(sellsWhat: string | undefined, signedIn: boolean) {
  const browse = sellsWhat === 'bookable' ? [EVENTS_LINK, PRODUCTS_LINK] : BROWSE;
  return signedIn ? [...browse, ...SESSION] : browse;
}

export function ShopHeader() {
  const { principal, signOut } = useAuth();
  const { cart } = useCart();
  const storefront = useStorefrontConfig();
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  // On a phone the labelled buttons cost the header a whole extra row; the
  // icons alone say the same thing. `sm === false`, not `!sm`: ANTD reports
  // undefined before it has measured, and undefined must not read as narrow.
  const narrow = screens.sm === false;

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
        {orderedLinks(storefront?.sellsWhat, Boolean(principal)).map((l) => {
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
        {/* Only once the owner has published a story: an About link over an
            empty page reads as a broken shop. */}
        {storefront && (
          <Link
            href="/about"
            aria-current={pathname.startsWith('/about') ? 'page' : undefined}
            data-active={pathname.startsWith('/about') || undefined}
          >
            <ShopOutlined />
            About
          </Link>
        )}
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
          <Badge count={cart.lines.length} size="small" offset={[-2, 2]}>
            <Button icon={<ShoppingCartOutlined />}>{narrow ? null : 'Cart'}</Button>
          </Badge>
        </Link>
        {principal ? (
          <>
            <span className="mp-role">{principal.role ?? 'no role'}</span>
            <ThemeToggle />
            <Button
              size="small"
              icon={<LogoutOutlined />}
              onClick={signOut}
              aria-label="Sign out"
            >
              {narrow ? null : 'Sign out'}
            </Button>
          </>
        ) : (
          <>
            <ThemeToggle />
            {/* Straight back to where they were: a stranger who signs in from
                a product page should land on that product, not the grid. */}
            <Link href={`/login?next=${encodeURIComponent(pathname)}`} aria-label="Sign in">
              <Button type="primary" icon={<LoginOutlined />}>
                {narrow ? null : 'Sign in'}
              </Button>
            </Link>
          </>
        )}
      </Space>
    </header>
  );
}
