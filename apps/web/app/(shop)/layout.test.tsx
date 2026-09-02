import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const push = vi.fn();
const signOut = vi.fn();
let pathname = '/products';
let principal: { tenantId: string; userId: string; role: string } | null = null;
let shop: { tenantId: string } | null | undefined = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));
vi.mock('../../lib/auth/auth-context', () => ({
  useAuth: () => ({ principal, ready: true, signOut }),
}));
vi.mock('../../lib/shop/shop-context', () => ({ useShop: () => shop }));
vi.mock('../../lib/shop/reads', () => ({
  useShopReads: () => ({ getStorefront: () => Promise.resolve(null) }),
}));
vi.mock('../../lib/api/http', () => ({ onUnauthorized: () => () => {} }));
vi.mock('../../lib/theme/theme-context', () => ({ useTheme: () => ({ mode: 'light' }) }));
vi.mock('../../components/shop-header', () => ({ ShopHeader: () => <div>header</div> }));
vi.mock('../../components/announcement-bar', () => ({ AnnouncementBar: () => null }));

import ShopShell from './layout';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ShopShell', () => {
  beforeEach(() => {
    push.mockClear();
    signOut.mockClear();
    principal = null;
    shop = null;
    pathname = '/products';
  });

  it('sends a stranger on the platform host to login', async () => {
    render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    await flush();
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('lets a stranger browse a shop host', async () => {
    shop = { tenantId: 'acme' };
    const { findByText } = render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    expect(await findByText('body')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('still protects the cart on a shop host, and says where to come back to', async () => {
    shop = { tenantId: 'acme' };
    pathname = '/cart';
    render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    await flush();
    expect(push).toHaveBeenCalledWith('/login?next=%2Fcart');
  });

  it('signs out a session that belongs to another shop', async () => {
    shop = { tenantId: 'acme' };
    principal = { tenantId: 'globex', userId: 'u', role: 'buyer' };
    render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    await flush();
    expect(signOut).toHaveBeenCalled();
  });

  it('keeps a session that matches the shop host', async () => {
    shop = { tenantId: 'acme' };
    principal = { tenantId: 'acme', userId: 'u', role: 'buyer' };
    const { findByText } = render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    expect(await findByText('body')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('renders nothing while the host is still unknown', async () => {
    shop = undefined;
    const { container } = render(
      <ShopShell>
        <p>body</p>
      </ShopShell>,
    );
    await flush();
    expect(container.textContent).toBe('');
    expect(push).not.toHaveBeenCalled();
  });
});
