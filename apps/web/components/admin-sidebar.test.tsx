import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdminSidebar } from './admin-sidebar';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/products' }));
vi.mock('../lib/auth/auth-context', () => ({
  useAuth: () => ({ principal: { tenantId: 'acme', role: 'admin' }, signOut: vi.fn() }),
}));
vi.mock('./theme-toggle', () => ({ ThemeToggle: () => null }));

describe('AdminSidebar', () => {
  // Every Sales entry is the shop's view, not the signed-in admin's own
  // purchases. Bookings used to point at the shopper's page, which for an
  // owner who never books is empty and looks like a broken feature.
  it('sends Orders and Bookings to the shop-wide cockpit pages', () => {
    render(<AdminSidebar />);

    expect(screen.getByRole('link', { name: /orders/i })).toHaveAttribute('href', '/admin/orders');
    expect(screen.getByRole('link', { name: /bookings/i })).toHaveAttribute('href', '/admin/bookings');
  });

  it('marks the current page for assistive tech', () => {
    render(<AdminSidebar />);

    expect(screen.getByRole('link', { name: /products/i })).toHaveAttribute('aria-current', 'page');
  });
});
