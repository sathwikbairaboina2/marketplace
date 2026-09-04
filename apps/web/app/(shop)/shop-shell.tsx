'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ConfigProvider } from 'antd';
import type { StorefrontConfig } from '@marketplace/contracts';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { useShop } from '../../lib/shop/shop-context';
import { useShopReads } from '../../lib/shop/reads';
import { StorefrontConfigProvider } from '../../lib/storefront-config';
import { resolveAntdAccent, resolveTheme } from '../../lib/theme/resolve';
import { useTheme } from '../../lib/theme/theme-context';
import { ShopHeader } from '../../components/shop-header';
import { AnnouncementBar } from '../../components/announcement-bar';
import { ShopFooter } from '../../components/shop-footer';

// What still needs a session on a shop host: a booking is somebody's. The
// cart, an order and its payment are a stranger's too now (lib/shop/commerce)
// -- a guest checkout is the whole point of a shop host -- and /orders shows
// a stranger a lookup form instead of a list. Browsing is nobody's.
const PROTECTED = ['/bookings'];
const isProtected = (pathname: string) => PROTECTED.some((p) => pathname.startsWith(p));

export default function ShopShell({ children }: { children: React.ReactNode }) {
  const { principal, ready, signOut } = useAuth();
  const { mode } = useTheme();
  const shop = useShop();
  const reads = useShopReads();
  const router = useRouter();
  const pathname = usePathname();
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  // A session from another shop is not a session here. Signed out rather
  // than tolerated: the token routes would answer for its own tenant, and a
  // page half from one shop and half from another is worse than none.
  const foreign = Boolean(shop && principal && principal.tenantId !== shop.tenantId);
  useEffect(() => {
    if (foreign) signOut();
  }, [foreign, signOut]);

  // Who must sign in: everyone on the platform host, where the token is what
  // names the tenant; and anyone reaching for a cart, an order or a booking
  // on a shop host. Nobody, to look at a shop.
  const known = shop !== undefined && ready;
  const needsSession = shop === null || (shop !== undefined && isProtected(pathname));
  const anonymous = !principal || foreign;
  useEffect(() => {
    if (!known || !needsSession || !anonymous) return;
    router.push(shop ? `/login?next=${encodeURIComponent(pathname)}` : '/login');
  }, [known, needsSession, anonymous, shop, router, pathname]);

  useEffect(() => {
    if (!known || (needsSession && anonymous)) return;
    reads
      .getStorefront()
      .then(setConfig)
      // A failed fetch renders the default theme; the shop must not be down
      // because theming is.
      .catch(() => setConfig(null))
      .finally(() => setConfigReady(true));
  }, [known, needsSession, anonymous, reads]);

  // The config fetch joins the session gate so a themed shop never flashes
  // the default palette on its way in.
  if (!known || (needsSession && anonymous) || !configReady) return null;

  const vars = config ? (resolveTheme(config, mode) as React.CSSProperties) : undefined;
  const accent = resolveAntdAccent(config, mode);

  const shell = (
    <StorefrontConfigProvider config={config}>
    <div className="mp-shop" style={vars}>
      {/* First thing in the tab order, invisible until focused. Without it a
          keyboard user walks the whole nav on every page before reaching the
          content they navigated to. */}
      <a href="#main" className="mp-skip">
        Skip to content
      </a>
      <AnnouncementBar />
      <ShopHeader />
      <main className="mp-shop-main" id="main" tabIndex={-1}>
        {children}
      </main>
      <ShopFooter />
    </div>
    </StorefrontConfigProvider>
  );

  if (!accent || !vars) return shell;
  const v = vars as Record<string, string>;
  const accentText = v['--mp-primary-text'];
  // The accent alone left every other antd token on the default theme: a
  // 10px button against a 6px card, Inter inside a shop that chose Fraunces,
  // and a cold slate table header on a warm page. The resolved variables are
  // the shop's, so hand antd the same ones.
  const px = (value: string | undefined, fallback: number) =>
    value ? Number.parseInt(value, 10) || fallback : fallback;
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: accent,
          colorLink: accentText,
          fontFamily: v['--mp-font-body'],
          borderRadius: px(v['--mp-radius-md'], 8),
          borderRadiusLG: px(v['--mp-radius-lg'], 10),
          borderRadiusSM: px(v['--mp-radius-sm'], 6),
          colorBorder: v['--mp-line'],
          colorBorderSecondary: v['--mp-line'],
          colorText: v['--mp-ink'],
          colorTextSecondary: v['--mp-ink-soft'],
          colorTextTertiary: v['--mp-muted'],
          colorBgContainer: v['--mp-surface-raised'],
          colorBgElevated: v['--mp-surface-raised'],
          // Status, which the wiring pass missed: `resolve.ts` works out a
          // per-preset success colour and handed it to nobody, so antd drew
          // its own blue Alert and green tick on every themed shop -- a cold
          // #e6f4ff panel on a cream confirmation page.
          colorInfo: accent,
          colorSuccess: v['--mp-success'],
          colorWarning: v['--mp-warning'],
          colorError: v['--mp-danger'],
        },
        components: {
          Table: {
            headerBg: v['--mp-surface-sunken'],
            headerColor: v['--mp-muted'],
            borderColor: v['--mp-line'],
          },
        },
      }}
    >
      {shell}
    </ConfigProvider>
  );
}
