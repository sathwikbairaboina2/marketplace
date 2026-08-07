# Visual Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ANTD's defaults with a designed identity — a dark grouped back-office and a light storefront — sharing one token set, with dark mode and responsive behaviour.

**Architecture:** One palette object feeds both an ANTD `ConfigProvider` theme and a set of CSS custom properties. Routes split into two Next.js route groups, each with its own shell. Presentation only: no request, contract or engine behaviour changes.

**Tech Stack:** Next.js App Router · ANTD v5 (`defaultAlgorithm` / `darkAlgorithm`) · `next/font/google` (Inter) · CSS custom properties · Vitest · Playwright.

**Spec:** `docs/superpowers/specs/2026-08-07-visual-identity-design.md`

## Global Constraints

- **The twelve existing Playwright specs must pass unchanged.** They are the regression net. Any edit to them needs a stated reason; "the redesign moved it" is not one.
- **Accessible names are a hard contract.** The existing specs select on these, so they must survive verbatim:
  - Links named exactly `Products`, `Orders`, `Flows`, `Chat` (`Flows`/`Chat` must remain **absent** for a buyer).
  - Buttons named exactly `Add to cart`, `Book`, `Create`, `Execute`, `Place order`, `Search`, `Sign out`, `Load more`, `Remove`.
  - Form labels: `Name`, `Description`, `Category`, `Price (minor units)`, `Stock`, `Title`, `Capacity`, `Starts`, `Ends`, `Base price (minor units)`, `Address`, `City`, `Postcode`, `Tickets`, `Min price (minor)`, `Max price (minor)`, and every generated field label (the registry field name).
  - `data-testid`: `composer`, `phase`, `confirm`, `image-input`, `persona`.
  - Tenant and role must render as **exact text** (`acme`, `admin`) on `/products` — `auth.spec.ts` asserts `getByText('acme', { exact: true })` after sign-in, which lands in the **shop** shell. Both shells therefore show identity.
  - Orders list and order detail keep an ANTD `Table` (`.ant-table-row` is asserted).
- Route groups do not change URLs: `app/(shop)/products` still serves `/products`.
- **Import depth changes.** A route group adds a directory level, so `../../lib/x` becomes `../../../lib/x` in every moved file. This is the most likely source of a broken build in Task 2.
- No API calls, contracts or engine behaviour change. A diff touching `lib/api/` is a signal something went wrong.
- Colour is never the sole carrier of meaning: every status renders colour **and** text.
- Fonts via `next/font/google` only — no runtime CDN request.
- Commit after every task. No Claude co-author trailer.

---

### Task 1: Theme tokens, fonts, and dark mode

Foundation only — no layout restructuring. At the end of this task the app looks recoloured, not rebuilt.

**Files:**
- Create: `apps/web/lib/theme/tokens.ts`, `tokens.test.ts`, `theme-context.tsx`, `theme-context.test.tsx`
- Create: `apps/web/components/theme-toggle.tsx`, `apps/web/app/theme.css`
- Modify: `apps/web/app/layout.tsx`, `apps/web/components/app-shell.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `palette` — `{ primary, primaryDeep, ink, muted, line, surface, surfaceRaised, sidebar, sidebarItem, ... }`
  - `antdTheme(mode: 'light' | 'dark'): ThemeConfig`
  - `cssVars(mode: 'light' | 'dark'): Record<string, string>`
  - `ThemeProvider`, `useTheme(): { mode: 'light' | 'dark'; setMode(m): void; toggle(): void }`
  - `ThemeToggle`
  - `THEME_STORAGE_KEY = 'marketplace.theme'`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/theme/tokens.test.ts
import { describe, expect, it } from 'vitest';
import { palette, antdTheme, cssVars } from './tokens';

describe('tokens', () => {
  it('exposes the slate and teal palette', () => {
    expect(palette.primary).toBe('#0d9488');
    expect(palette.ink).toBe('#0f172a');
  });

  it('builds an ANTD theme whose primary matches the palette in both modes', () => {
    for (const mode of ['light', 'dark'] as const) {
      expect(antdTheme(mode).token?.colorPrimary).toBe(palette.primary);
    }
  });

  it('selects a different algorithm per mode', () => {
    expect(antdTheme('light').algorithm).not.toBe(antdTheme('dark').algorithm);
  });

  // The whole reason both consumers derive from one object: a value that
  // differs between the ANTD config and the stylesheet is a Button that no
  // longer matches the panel it sits on.
  it('emits CSS variables that agree with the ANTD token', () => {
    const vars = cssVars('light');
    expect(vars['--mp-primary']).toBe(palette.primary);
    expect(vars['--mp-primary']).toBe(antdTheme('light').token?.colorPrimary);
  });

  it('emits a different surface for dark than for light', () => {
    expect(cssVars('dark')['--mp-surface']).not.toBe(cssVars('light')['--mp-surface']);
  });

  it('names every variable with the same prefix', () => {
    for (const key of Object.keys(cssVars('light'))) expect(key.startsWith('--mp-')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @marketplace/web test -- tokens`
Expected: FAIL — `Cannot find module './tokens'`.

- [ ] **Step 3: Write the tokens**

```ts
// apps/web/lib/theme/tokens.ts
import { theme, type ThemeConfig } from 'antd';

export type Mode = 'light' | 'dark';

/**
 * Slate and teal. Shopify-informed rather than Shopify's own green, which on a
 * product that is not theirs would read as borrowed.
 */
export const palette = {
  primary: '#0d9488',
  primaryDeep: '#115e59',
  ink: '#0f172a',
  muted: '#475569',
  line: '#e2e8f0',
  surface: '#f8fafc',
  surfaceRaised: '#ffffff',
  sidebar: '#0f172a',
  sidebarItem: '#1e293b',
  sidebarText: '#cbd5e1',
  success: '#0d9488',
  warning: '#b45309',
  danger: '#b91c1c',
} as const;

const dark = {
  ink: '#e2e8f0',
  muted: '#94a3b8',
  line: '#1e293b',
  surface: '#0b1220',
  surfaceRaised: '#111827',
} as const;

export const radius = { sm: 6, md: 10, lg: 14 } as const;

export function antdTheme(mode: Mode): ThemeConfig {
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: palette.primary,
      colorSuccess: palette.success,
      colorWarning: palette.warning,
      colorError: palette.danger,
      borderRadius: radius.md,
      fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
      fontSize: 14,
    },
    components: {
      Layout: { bodyBg: mode === 'dark' ? dark.surface : palette.surface },
      Card: { borderRadiusLG: radius.md },
      Table: { headerBg: mode === 'dark' ? dark.surfaceRaised : palette.surface },
    },
  };
}

/** The surfaces ANTD does not own: sidebar, hero, filter rail, product card. */
export function cssVars(mode: Mode): Record<string, string> {
  const m = mode === 'dark' ? { ...palette, ...dark } : palette;
  return {
    '--mp-primary': m.primary,
    '--mp-primary-deep': m.primaryDeep,
    '--mp-ink': m.ink,
    '--mp-muted': m.muted,
    '--mp-line': m.line,
    '--mp-surface': m.surface,
    '--mp-surface-raised': m.surfaceRaised,
    '--mp-sidebar': palette.sidebar,
    '--mp-sidebar-item': palette.sidebarItem,
    '--mp-sidebar-text': palette.sidebarText,
    '--mp-radius-sm': `${radius.sm}px`,
    '--mp-radius-md': `${radius.md}px`,
    '--mp-radius-lg': `${radius.lg}px`,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @marketplace/web test -- tokens`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the theme context test, then the context**

```tsx
// apps/web/lib/theme/theme-context.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, THEME_STORAGE_KEY } from './theme-context';

function Probe() {
  const { mode, toggle } = useTheme();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={toggle}>flip</button>
    </div>
  );
}

const renderProbe = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

const stubMatchMedia = (prefersDark: boolean) =>
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  });

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    stubMatchMedia(false);
  });

  it('defaults to the operating system preference when nothing is stored', async () => {
    stubMatchMedia(true);
    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
  });

  it('prefers an explicitly stored choice over the OS preference', async () => {
    stubMatchMedia(true);
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('mode')).toHaveTextContent('light');
  });

  it('persists a toggle so the choice survives a reload', async () => {
    renderProbe();
    await act(async () => {
      screen.getByText('flip').click();
    });
    expect(screen.getByTestId('mode')).toHaveTextContent('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('stamps the mode onto the document element', async () => {
    renderProbe();
    await act(async () => {
      screen.getByText('flip').click();
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
```

Run it, watch it fail, then:

```tsx
// apps/web/lib/theme/theme-context.tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ConfigProvider } from 'antd';
import { antdTheme, cssVars, type Mode } from './tokens';

export const THEME_STORAGE_KEY = 'marketplace.theme';

interface ThemeValue {
  mode: Mode;
  setMode: (m: Mode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const systemMode = (): Mode =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts light and corrects on mount. The inline script in layout.tsx has
  // already stamped `data-theme` before first paint, so nothing flashes -- this
  // state only needs to catch up with what the document already says.
  const [mode, setModeState] = useState<Mode>('light');

  useEffect(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as Mode | null;
    setModeState(stored === 'dark' || stored === 'light' ? stored : systemMode());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    for (const [key, value] of Object.entries(cssVars(mode))) {
      document.documentElement.style.setProperty(key, value);
    }
  }, [mode]);

  const setMode = useCallback((next: Mode) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setModeState(next);
  }, []);

  const toggle = useCallback(
    () => setMode(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
    [setMode],
  );

  return (
    <ThemeContext.Provider value={{ mode, setMode, toggle }}>
      <ConfigProvider theme={antdTheme(mode)}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
```

- [ ] **Step 6: Write the toggle and wire the root layout**

```tsx
// apps/web/components/theme-toggle.tsx
'use client';

import { Button, Tooltip } from 'antd';
import { useTheme } from '../lib/theme/theme-context';

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const next = mode === 'dark' ? 'light' : 'dark';
  return (
    <Tooltip title={`Switch to ${next} mode`}>
      <Button size="small" aria-label={`Switch to ${next} mode`} onClick={toggle}>
        {mode === 'dark' ? '☾' : '☀'}
      </Button>
    </Tooltip>
  );
}
```

```tsx
// apps/web/app/layout.tsx
import { Inter } from 'next/font/google';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import '@ant-design/v5-patch-for-react-19';
import './theme.css';
import { ThemeProvider } from '../lib/theme/theme-context';
import { AuthProvider } from '../lib/auth/auth-context';
import { SchemaProvider } from '../lib/schemas/schema-cache';
import { CartProvider } from '../lib/cart/cart-context';
import { ContractBanner } from '../components/contract-banner';

// Downloaded at build time and self-hosted -- nothing fetches a font at
// runtime, which matters because the container is the only place this runs.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata = { title: 'Marketplace' };

/**
 * Runs before first paint. Without it the page renders light and corrects
 * itself on hydration -- the most conspicuous defect a dark mode can have.
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var s=localStorage.getItem('marketplace.theme');
  var m=s==='dark'||s==='light'?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  document.documentElement.dataset.theme=m;
}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <AntdRegistry>
          <ThemeProvider>
            <AuthProvider>
              <SchemaProvider>
                <CartProvider>
                  <ContractBanner />
                  {children}
                </CartProvider>
              </SchemaProvider>
            </AuthProvider>
          </ThemeProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
```

**Keep `AppShell` for now.** The layout above omits it because Task 2 deletes it, but removing it in this task would leave the app with no navigation between the two commits. Wrap `{children}` in `<AppShell>` here exactly as it is today, and delete it in Task 2 Step 7. Each task has to leave the application working.

```css
/* apps/web/app/theme.css */
:root { color-scheme: light; }
:root[data-theme='dark'] { color-scheme: dark; }
body { margin: 0; background: var(--mp-surface); color: var(--mp-ink); }
```

- [ ] **Step 7: Verify**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web build`
Then rebuild the container and confirm by hand: the toggle flips the theme, a reload keeps it, and there is **no flash of light** on load in dark mode.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): slate and teal theme tokens with dark mode"
```

---

### Task 2: Route groups and the two shells

**Files:**
- Move: `app/products`, `app/events`, `app/cart`, `app/orders`, `app/bookings` → `app/(shop)/…`
- Move: `app/admin/*` → `app/(admin)/admin/*`
- Create: `app/(shop)/layout.tsx`, `app/(admin)/layout.tsx`, `components/shop-header.tsx`, `components/admin-sidebar.tsx`
- Delete: `components/app-shell.tsx`
- Modify: `app/layout.tsx`, `app/login/page.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useCart`, `onUnauthorized`, `ThemeToggle`.
- Produces: `ShopShell`, `AdminShell`, `ShopHeader`, `AdminSidebar`.

- [ ] **Step 1: Move the routes**

```bash
cd apps/web/app
mkdir -p "(shop)" "(admin)"
git mv products events cart orders bookings "(shop)/"
git mv admin "(admin)/"
```

`app/api/*`, `app/login`, `app/page.tsx` and `app/layout.tsx` stay put.

- [ ] **Step 2: Fix the import depth**

Every moved file gained one directory level, so relative imports need one more `../`. For example `app/(shop)/products/page.tsx`:

```diff
-import { listProducts, searchProducts } from '../../lib/api/products';
+import { listProducts, searchProducts } from '../../../lib/api/products';
```

Run `pnpm --filter @marketplace/web exec tsc --noEmit` and fix what it reports — it lists every one. This is the step most likely to look broken; the type checker is exhaustive here, so trust it rather than grepping.

- [ ] **Step 3: Write the shop header**

Accessible names here are load-bearing: `auth.spec.ts` asserts a buyer sees links named `Products` and `Orders` and **no** `Flows`/`Chat`, and that `acme` and `admin` render as exact text on `/products`. `isolation.spec.ts` clicks a `Sign out` button from this shell.

```tsx
// apps/web/components/shop-header.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, Button, Space, Tag } from 'antd';
import { useAuth } from '../lib/auth/auth-context';
import { useCart } from '../lib/cart/cart-context';
import { ThemeToggle } from './theme-toggle';

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
          <Link key={l.href} href={l.href} data-active={pathname.startsWith(l.href)}>
            {l.label}
          </Link>
        ))}
        {/* Deliberately not named Flows or Chat: auth.spec asserts a buyer sees
            neither, and this link is admin-only anyway. */}
        {principal?.role === 'admin' && <Link href="/admin/products">Admin</Link>}
      </nav>

      <Space>
        <Link href="/cart">
          <Badge count={lines.length} size="small">
            <Button>Cart</Button>
          </Badge>
        </Link>
        {/* Exact text, because auth.spec matches `acme` and `admin` exactly. */}
        <Tag color="blue">{principal?.tenantId}</Tag>
        <Tag>{principal?.role ?? 'no role'}</Tag>
        <ThemeToggle />
        <Button size="small" onClick={signOut}>
          Sign out
        </Button>
      </Space>
    </header>
  );
}
```

- [ ] **Step 4: Write the admin sidebar**

```tsx
// apps/web/components/admin-sidebar.tsx
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
      <Link href="/products" className="mp-sidebar-brand">
        Marketplace
      </Link>

      {GROUPS.map((group) => (
        <div key={group.label} className="mp-sidebar-group">
          <div className="mp-sidebar-label">{group.label}</div>
          {group.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              data-active={pathname === item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}

      {/* The tenant carries real weight here. Moving identity out of a top bar
          cost it prominence, and switching acme/globex is how tenant isolation
          is demonstrated -- it has to be somewhere the eye lands. */}
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
```

- [ ] **Step 5: Write the two group layouts**

Both keep the redirect-to-login guard that `AppShell` had, and both register `onUnauthorized`.

```tsx
// apps/web/app/(shop)/layout.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { ShopHeader } from '../../components/shop-header';

export default function ShopShell({ children }: { children: React.ReactNode }) {
  const { principal, ready } = useAuth();
  const router = useRouter();

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);
  useEffect(() => {
    if (ready && !principal) router.push('/login');
  }, [ready, principal, router]);

  if (!ready || !principal) return null;

  return (
    <div className="mp-shop">
      <ShopHeader />
      <main className="mp-shop-main">{children}</main>
    </div>
  );
}
```

```tsx
// apps/web/app/(admin)/layout.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Drawer, Grid } from 'antd';
import { useAuth } from '../../lib/auth/auth-context';
import { onUnauthorized } from '../../lib/api/http';
import { AdminSidebar } from '../../components/admin-sidebar';

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const { principal, ready } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  const wide = Boolean(screens.lg);

  useEffect(() => onUnauthorized(() => router.push('/login')), [router]);
  useEffect(() => {
    if (ready && !principal) router.push('/login');
  }, [ready, principal, router]);

  if (!ready || !principal) return null;

  return (
    <div className="mp-admin">
      {wide ? (
        <AdminSidebar />
      ) : (
        <>
          <Button className="mp-admin-menu" onClick={() => setOpen(true)} aria-label="Open menu">
            ☰
          </Button>
          <Drawer
            open={open}
            onClose={() => setOpen(false)}
            placement="left"
            width={240}
            styles={{ body: { padding: 0, background: 'var(--mp-sidebar)' } }}
          >
            <AdminSidebar onNavigate={() => setOpen(false)} />
          </Drawer>
        </>
      )}
      <main className="mp-admin-main">{children}</main>
    </div>
  );
}
```

- [ ] **Step 6: Add the shell styles**

Append to `apps/web/app/theme.css`: `.mp-shop-header` as a flex row with a bottom border; `.mp-shop-nav a` with a `data-active` underline in `--mp-primary`; `.mp-admin` as a flex row; `.mp-sidebar` fixed 240px, `background: var(--mp-sidebar)`, `color: var(--mp-sidebar-text)`, with `.mp-sidebar-tenant` at 15px/600 in white on a `--mp-sidebar-item` block; `.mp-admin-menu` visible only below `lg`. Content areas get `padding: 24px` and `max-width: 1200px`.

- [ ] **Step 7: Remove the old shell and verify**

Delete `components/app-shell.tsx` and its import from the root layout.

Run: `pnpm --filter @marketplace/web exec tsc --noEmit && pnpm --filter @marketplace/web build && pnpm --filter @marketplace/web test`
Then rebuild the container and run the **whole existing e2e suite**:
`pnpm --filter @marketplace/web exec playwright test`
Expected: all twelve pass unchanged. `auth.spec.ts` is the one to watch — it exercises exactly the names this task moves.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): split the console into a back-office and a storefront shell"
```

---

### Task 3: Shared presentation components

**Files:**
- Create: `components/status-tag.tsx`, `status-tag.test.tsx`, `components/page-header.tsx`, `components/empty-state.tsx`
- Modify: `components/cursor-table.tsx`, and the flow/order/booking pages that render a status

**Interfaces:**
- Consumes: `palette`.
- Produces: `StatusTag` (prop `status: string`), `PageHeader` (`title`, `subtitle?`, `extra?`), `EmptyState` (`title`, `description?`, `action?`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/status-tag.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTag } from './status-tag';

describe('StatusTag', () => {
  it('renders the status text for every known status', () => {
    for (const s of [
      'proposed', 'applied', 'rejected',
      'pending', 'confirmed', 'cancelled',
      'active', 'draft', 'archived', 'out_of_stock',
    ]) {
      const { unmount } = render(<StatusTag status={s} />);
      // Colour is never the only carrier: a colour-blind viewer has to be able
      // to tell `proposed` from `applied`, and these states gate whether a
      // tenant's data model is irreversibly mutated.
      expect(screen.getByText(s.replace('_', ' '))).toBeInTheDocument();
      unmount();
    }
  });

  it('distinguishes a terminal failure from a success', () => {
    const { container: applied } = render(<StatusTag status="applied" />);
    const { container: rejected } = render(<StatusTag status="rejected" />);
    expect(applied.querySelector('.ant-tag')?.className).not.toBe(
      rejected.querySelector('.ant-tag')?.className,
    );
  });

  it('falls back to a neutral tag for an unrecognised status', () => {
    render(<StatusTag status="something-new" />);
    expect(screen.getByText('something-new')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

```tsx
// apps/web/components/status-tag.tsx
'use client';

import { Tag } from 'antd';

// Mapped explicitly rather than by heuristic: `cancelled` and `rejected` are
// both endings but only one is a failure, and guessing from the string would
// eventually get that wrong.
const COLOURS: Record<string, string> = {
  applied: 'green',
  confirmed: 'green',
  active: 'green',
  proposed: 'gold',
  pending: 'gold',
  draft: 'default',
  archived: 'default',
  out_of_stock: 'orange',
  rejected: 'red',
  cancelled: 'red',
};

export function StatusTag({ status }: { status: string }) {
  return <Tag color={COLOURS[status] ?? 'default'}>{status.replace('_', ' ')}</Tag>;
}
```

```tsx
// apps/web/components/page-header.tsx
'use client';

import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="mp-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {extra && <div className="mp-page-header-extra">{extra}</div>}
    </div>
  );
}
```

```tsx
// apps/web/components/empty-state.tsx
'use client';

import { Empty } from 'antd';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <>
          <strong>{title}</strong>
          {description && <p style={{ color: 'var(--mp-muted)', marginTop: 4 }}>{description}</p>}
        </>
      }
    >
      {action}
    </Empty>
  );
}
```

- [ ] **Step 3: Give CursorTable a skeleton and an empty state**

In `components/cursor-table.tsx`, accept an optional `empty?: ReactNode` prop and pass ANTD's `locale={{ emptyText: empty ?? <EmptyState title="Nothing here yet" /> }}`. While `loading` is true and `items` is empty, render `<Skeleton active paragraph={{ rows: 5 }} />` instead of the table — a spinner over an empty rectangle tells the user nothing about what is coming.

- [ ] **Step 4: Adopt StatusTag on the pages that show a status**

Replace the ad-hoc `Tag` in `app/(admin)/admin/flows/page.tsx` and the bare status text in the orders, order-detail, bookings, booking-detail, products list and product-detail pages. Do **not** change any label text these pages render — `catalogue.spec.ts` and `idempotency.spec.ts` match on names and row counts.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web exec tsc --noEmit`
Then the full e2e suite. Expected: all pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): shared page header, empty state and semantic status tags"
```

---

### Task 4: The storefront

**Files:**
- Create: `components/product-card.tsx`, `components/product-grid.tsx`, `components/storefront-hero.tsx`, `components/filter-rail.tsx`, `lib/placeholder.ts`, `lib/placeholder.test.ts`
- Modify: `app/(shop)/products/page.tsx`, `app/(shop)/products/[id]/page.tsx`, `app/(shop)/events/page.tsx`

**Interfaces:**
- Consumes: `useSchema`, `toFilterItems`, `toAttributes`, `listProducts`, `searchProducts`, `ProductResponse`.
- Produces: `placeholderFor(id: string, name: string): { gradient: string; initials: string }`, `ProductCard`, `ProductGrid`, `StorefrontHero`, `FilterRail`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/placeholder.test.ts
import { describe, expect, it } from 'vitest';
import { placeholderFor } from './placeholder';

describe('placeholderFor', () => {
  // Determinism is the whole point: a product whose gradient changes between
  // renders reads as a loading bug.
  it('is stable for the same id', () => {
    expect(placeholderFor('01J', 'Aeron Chair')).toEqual(placeholderFor('01J', 'Aeron Chair'));
  });

  it('differs across ids', () => {
    expect(placeholderFor('01J', 'X').gradient).not.toBe(placeholderFor('02K', 'X').gradient);
  });

  it('takes initials from the first two words', () => {
    expect(placeholderFor('01J', 'Aeron Desk Chair').initials).toBe('AD');
    expect(placeholderFor('01J', 'Keyboard').initials).toBe('K');
  });

  it('survives an empty or punctuation-only name', () => {
    expect(placeholderFor('01J', '').initials).toBe('?');
    expect(placeholderFor('01J', '   ').initials).toBe('?');
  });
});
```

- [ ] **Step 2: Run it to verify it fails, then implement**

```ts
// apps/web/lib/placeholder.ts

/** Cheap, stable string hash. Not security-relevant -- only needs to spread. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * A deterministic stand-in for a product with no photograph, so the grid never
 * renders as broken boxes and the same product always looks the same.
 */
export function placeholderFor(id: string, name: string): { gradient: string; initials: string } {
  const hue = hash(id) % 360;
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?';

  return {
    gradient: `linear-gradient(135deg, hsl(${hue} 32% 82%), hsl(${(hue + 40) % 360} 28% 92%))`,
    initials,
  };
}
```

- [ ] **Step 3: Write the card, grid, hero and rail**

`ProductCard` renders `product.images[0]` as a plain `<img>` at a fixed aspect ratio, or the placeholder gradient with initials. Below it: name as a `Link` to `/products/{id}` (the **product name must remain plain visible text** — `catalogue.spec` and `isolation.spec` assert `getByText(name)`), formatted price, and a `StatusTag` when the status is not `active`.

`ProductGrid` is a responsive CSS grid: `repeat(auto-fill, minmax(240px, 1fr))`, which gives three across at desktop, two at tablet and one on a phone without a media query per breakpoint.

`StorefrontHero` takes `{ tenantId, productCount, categoryCount, newest }` and renders the dark panel. All four come from data already fetched for the page — **no new API call**; the counts derive from the first page of products, and the copy says "9 products" only because nine were loaded, so word it as "Showing N products across M categories".

`FilterRail` wraps the existing `toFilterItems(schema.fields)` plus the hand-written price range in a bordered column, keeping the labels `Min price (minor)` and `Max price (minor)` and a submit button named `Search` exactly as they are. Below `md` it renders inside a `Drawer` opened by a `Filters` button.

- [ ] **Step 4: Rewrite the products page**

Replace `CursorTable` with `ProductGrid` while keeping the load-more behaviour and the filter submission logic unchanged. The page must still call `listProducts` when unfiltered and `searchProducts` when any filter is set.

`registry-loop.spec.ts` asserts `getByLabel(fieldName)` is visible on `/products` after a flow executes, so the generated filters must remain labelled inputs **rendered on the page**, not hidden inside a closed drawer at desktop width.

- [ ] **Step 5: Verify**

Run: `pnpm --filter @marketplace/web test && pnpm --filter @marketplace/web build`, rebuild the container, then the full e2e suite.

Expected: all twelve pass. `catalogue.spec.ts` (filter narrows the grid), `registry-loop.spec.ts` (generated filter visible) and `image-upload.spec.ts` (`img[src="…"]` visible on `/products`) are the three that exercise this task directly.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): storefront grid, hero and persistent filter rail"
```

---

### Task 5: Admin list pages

A consequence of two shells: a route renders in one chrome, so the admin side needs its own catalogue views.

**Files:**
- Create: `app/(admin)/admin/products/page.tsx`, `app/(admin)/admin/events/page.tsx`
- Modify: the remaining admin pages to use `PageHeader`

**Interfaces:**
- Consumes: `CursorTable`, `listProducts`, `listEvents`, `StatusTag`, `PageHeader`.
- Produces: routes `/admin/products` and `/admin/events`.

- [ ] **Step 1: Write the admin products list**

A dense `CursorTable` with columns: 40px thumbnail, name, category, price, stock, `StatusTag`.

The name links to `/products/{id}` on the storefront, not to an admin detail route — there is no admin product detail page and this plan does not add one, since the storefront detail view already shows everything an admin would look at. Following that link crosses into the shop shell, which is expected.

`PageHeader` titled "Products" with a `New product` link button as `extra`, and an `EmptyState` offering the same action.

- [ ] **Step 2: Write the admin events list**

Same shape against `listEvents`: title, starts, capacity, `bookedCount`, price. Header action `New event`.

- [ ] **Step 3: Apply PageHeader across the admin pages**

`admin/flows`, `admin/flows/[id]`, `admin/chat`, `admin/products/new`, `admin/events/new`. Keep every existing button name — `Create`, `Execute`, and the chat test ids — untouched.

- [ ] **Step 4: Verify**

Run the unit suite, the build, and the full e2e suite. Navigate `/admin/products` and `/admin/events` by hand and confirm the sidebar marks the right item active.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): admin catalogue list pages"
```

---

### Task 6: Responsive behaviour and new coverage

**Files:**
- Modify: `app/theme.css`, `components/cursor-table.tsx`
- Create: `apps/web/test/e2e/theme.spec.ts`, `apps/web/test/e2e/responsive.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Make the tables survive a narrow viewport**

Give `CursorTable` `scroll={{ x: 'max-content' }}`. A cursor-paginated table has no honest narrow layout — no page count to summarise, no safely droppable column — and stacking cells reads worse than a scroll.

- [ ] **Step 2: Write the new specs**

```ts
// apps/web/test/e2e/theme.spec.ts
import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('a chosen theme survives a reload', async ({ page }) => {
  await signIn(page, 'acme-admin');

  const initial = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).click();

  const flipped = await page.locator('html').getAttribute('data-theme');
  expect(flipped).not.toBe(initial);

  await page.reload();
  // The inline bootstrap script must restore this before first paint; if it
  // only applied on hydration the attribute would briefly be wrong.
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped!);
});
```

```ts
// apps/web/test/e2e/responsive.spec.ts
import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('the admin sidebar collapses to a drawer on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await signIn(page, 'acme-admin');
  await page.goto('/admin/flows');

  // Collapsed: the nav is not on the page until the menu is opened.
  await expect(page.getByRole('link', { name: 'Chat' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
});
```

- [ ] **Step 3: Run everything**

Run: `pnpm docker:down && pnpm e2e`
Expected: exit 0 — engine, agents, and fourteen web specs.

- [ ] **Step 4: Document**

In `README.md`'s console section, note the two shells, the theme toggle and where preference is stored, and that the storefront filter rail is generated from the registry.

- [ ] **Step 5: Commit**

```bash
git add apps/web README.md
git commit -m "test(web): theme persistence and responsive sidebar coverage"
```

---

## Verification

```bash
pnpm docker:down
pnpm install
pnpm build
pnpm e2e
```

Expected: every unit suite passes, all three e2e suites pass, exit 0, no "worker process has failed to exit gracefully", `marketplace_ollama-models` still present.

**The bar for this work is that the original twelve e2e specs pass untouched.** They select by accessible role and label throughout, so they are what proves a visual redesign did not quietly become a behavioural one.

Then by hand, with the stack up: sign in as `acme-admin`; confirm the storefront hero reports the real catalogue; toggle dark mode and reload; visit `/admin/flows` and confirm the dark grouped sidebar with the tenant prominent in its foot; narrow the window and confirm the sidebar becomes a drawer and the grid reflows to one column; sign in as `globex-admin` and confirm the tenant block changes.
