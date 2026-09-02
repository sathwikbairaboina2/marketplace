import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { StorefrontConfig } from '@marketplace/contracts';

vi.mock('next/navigation', () => ({ usePathname: () => '/products' }));
// A cell, not a literal: the stranger cases below swap it and put it back.
let auth: { principal: { tenantId: string; role: string } | null; signOut: () => void } = {
  principal: { tenantId: 'acme', role: 'buyer' },
  signOut: vi.fn(),
};
vi.mock('../lib/auth/auth-context', () => ({ useAuth: () => auth }));
vi.mock('../lib/cart/cart-context', () => ({ useCart: () => ({ cart: { lines: [] } }) }));
vi.mock('./theme-toggle', () => ({ ThemeToggle: () => null }));

import { StorefrontConfigProvider } from '../lib/storefront-config';
import { ShopHeader } from './shop-header';

const config = (sellsWhat?: 'goods' | 'bookable' | 'both'): StorefrontConfig => ({
  presetId: 'artisan',
  overrides: {},
  about: { title: 'About', sections: [{ heading: 'h', body: 'b' }] },
  banners: [],
  businessProfile: { kind: 'shop', name: 'Acme', tone: 'warm', audience: 'all' },
  ...(sellsWhat ? { sellsWhat } : {}),
});

const navOrder = () =>
  screen
    .getAllByRole('link')
    .map((a) => a.textContent?.trim())
    .filter((label) => label === 'Products' || label === 'Events');

const renderWith = (storefront: StorefrontConfig | null) =>
  render(
    <StorefrontConfigProvider config={storefront}>
      <ShopHeader />
    </StorefrontConfigProvider>,
  );

describe('ShopHeader nav order', () => {
  it('leads with Products for a shop that sells goods', () => {
    renderWith(config('goods'));

    expect(navOrder()).toEqual(['Products', 'Events']);
  });

  it('leads with Events for a bookable shop', () => {
    renderWith(config('bookable'));

    expect(navOrder()).toEqual(['Events', 'Products']);
  });

  it('leads with Products for a shop published before sellsWhat existed', () => {
    renderWith(config());

    expect(navOrder()).toEqual(['Products', 'Events']);
  });

  it('leads with Products when no storefront has been published at all', () => {
    renderWith(null);

    expect(navOrder()).toEqual(['Products', 'Events']);
  });

  it('keeps both link names exactly as the auth journey asserts them', () => {
    renderWith(config('bookable'));

    expect(screen.getByRole('link', { name: /Products/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Events/ })).toBeInTheDocument();
  });
});

// Regexes for the nav links: each carries an icon whose aria-label joins the
// accessible name, so `Products` is really `appstore Products`.
describe('ShopHeader for a stranger', () => {
  const buyer = { principal: { tenantId: 'acme', role: 'buyer' }, signOut: vi.fn() };

  it('offers Sign in pointing back at the page, and hides what needs a session', () => {
    auth = { principal: null, signOut: vi.fn() };
    try {
      renderWith(null);
      expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
        'href',
        '/login?next=%2Fproducts',
      );
      expect(screen.queryByRole('link', { name: /Orders/ })).toBeNull();
      expect(screen.queryByRole('link', { name: /Bookings/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
      expect(screen.getByRole('link', { name: /Products/ })).toBeInTheDocument();
    } finally {
      auth = buyer;
    }
  });

  it('keeps Orders and Sign out for a signed-in buyer', () => {
    auth = buyer;
    renderWith(null);
    expect(screen.getByRole('link', { name: /Orders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
