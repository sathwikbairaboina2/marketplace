'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ConfigProvider } from 'antd';
import type { StorefrontConfig } from '@marketplace/contracts';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { getPublishedStorefront } from '../../lib/api/storefront';
import { StorefrontConfigProvider } from '../../lib/storefront-config';
import { resolveAntdAccent, resolveTheme } from '../../lib/theme/resolve';
import { useTheme } from '../../lib/theme/theme-context';
import { ShopHeader } from '../../components/shop-header';
import { AnnouncementBar } from '../../components/announcement-bar';

export default function ShopShell({ children }: { children: React.ReactNode }) {
  const { principal, ready } = useAuth();
  const { mode } = useTheme();
  const router = useRouter();
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [configReady, setConfigReady] = useState(false);

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  useEffect(() => {
    if (ready && !principal) router.push('/login');
  }, [ready, principal, router]);

  useEffect(() => {
    if (!ready || !principal) return;
    getPublishedStorefront()
      .then(setConfig)
      // A failed fetch renders the default theme; the shop must not be down
      // because theming is.
      .catch(() => setConfig(null))
      .finally(() => setConfigReady(true));
  }, [ready, principal]);

  // The config fetch joins the existing auth gate so a themed shop never
  // flashes the default palette on its way in.
  if (!ready || !principal || !configReady) return null;

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
    </div>
    </StorefrontConfigProvider>
  );

  if (!accent || !vars) return shell;
  const accentText = (vars as Record<string, string>)['--mp-primary-text'];
  return (
    <ConfigProvider theme={{ token: { colorPrimary: accent, colorLink: accentText } }}>
      {shell}
    </ConfigProvider>
  );
}
