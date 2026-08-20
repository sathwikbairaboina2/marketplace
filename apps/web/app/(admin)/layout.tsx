'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, ConfigProvider, Drawer, Grid } from 'antd';
import { MenuOutlined } from '@ant-design/icons';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { getOnboardingFlag, getPublishedStorefront } from '../../lib/api/storefront';
import { AdminSidebar } from '../../components/admin-sidebar';
import { cockpitAntdTheme } from '../../lib/theme/tokens';
import { useTheme } from '../../lib/theme/theme-context';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { principal, ready } = useAuth();
  const { mode } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const checkedOnboarding = useRef(false);
  const screens = Grid.useBreakpoint();
  // Undefined on the first render before ANTD measures, so treat only an
  // explicit false as narrow -- otherwise the sidebar flickers into a drawer
  // on every desktop load.
  const wide = screens.lg !== false;

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);

  useEffect(() => {
    if (ready && !principal) router.push('/login');
  }, [ready, principal, router]);

  // A store that has never been published and never dismissed the wizard opens
  // on it. Once per mount (the ref), never while already there, and any fetch
  // failure means "stay put" -- onboarding is an invitation, not a cage.
  useEffect(() => {
    if (!ready || principal?.role !== 'admin' || checkedOnboarding.current) return;
    if (pathname.startsWith('/admin/onboarding')) return;
    checkedOnboarding.current = true;
    void Promise.all([getPublishedStorefront(), getOnboardingFlag()])
      .then(([published, flag]) => {
        if (published === null && !flag.dismissed) router.replace('/admin/onboarding');
      })
      .catch(() => {});
  }, [ready, principal, pathname, router]);

  if (!ready || !principal) return null;

  return (
    // The cockpit runs its own ANTD slice -- green primary, same bones -- so
    // the seller's space can be bold while the storefront stays calm.
    <ConfigProvider theme={cockpitAntdTheme(mode)}>
    <div className="mp-admin">
      <a href="#main" className="mp-skip">
        Skip to content
      </a>
      {wide ? (
        <AdminSidebar />
      ) : (
        <>
          <Button
            className="mp-admin-menu"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            icon={<MenuOutlined />}
          />
          <Drawer
            open={open}
            onClose={() => setOpen(false)}
            placement="left"
            width={240}
            closable={false}
            styles={{ body: { padding: 0, background: 'var(--mp-sidebar)' } }}
          >
            <AdminSidebar onNavigate={() => setOpen(false)} />
          </Drawer>
        </>
      )}
      <main className="mp-admin-main" id="main" tabIndex={-1}>
        {children}
      </main>
    </div>
    </ConfigProvider>
  );
}
