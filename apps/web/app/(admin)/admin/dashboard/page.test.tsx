import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import DashboardPage from './page';

const getSalesStats = vi.fn();
vi.mock('../../../../lib/api/stats', () => ({ getSalesStats: () => getSalesStats() }));

const STATS = {
  orders: { total: 7, confirmed: 5, awaitingPayment: 1, cancelled: 1 },
  revenueMinorByCurrency: { INR: 123400, USD: 5600 },
  topProducts: [
    { productId: 'p1', name: 'Kettle', units: 9, revenueMinor: 90000, currency: 'INR' },
  ],
  lowStock: [{ id: 'p2', name: 'Mug', stock: 2 }],
  truncated: false,
};

beforeEach(() => getSalesStats.mockReset().mockResolvedValue(STATS));

describe('DashboardPage', () => {
  it('shows order counts and one revenue card per currency, never a cross-currency sum', async () => {
    render(<DashboardPage />);
    await act(async () => {});

    expect(screen.getByText('Awaiting payment')).toBeInTheDocument();
    expect(screen.getByText('Revenue (INR)')).toBeInTheDocument();
    expect(screen.getByText('Revenue (USD)')).toBeInTheDocument();
    // 1,234.00 + 56.00 = 1,290.00 must never appear anywhere.
    expect(screen.queryByText(/1,?290/)).toBeNull();
  });

  it('links top products to the shop and low stock to the editor', async () => {
    render(<DashboardPage />);
    await act(async () => {});

    expect(screen.getByRole('link', { name: 'Kettle' })).toHaveAttribute('href', '/products/p1');
    expect(screen.getByRole('link', { name: 'Mug' })).toHaveAttribute(
      'href',
      '/admin/products/p2/edit',
    );
  });

  it('flags a truncated scan as a floor, not a total', async () => {
    getSalesStats.mockResolvedValue({ ...STATS, truncated: true });
    render(<DashboardPage />);
    await act(async () => {});
    expect(screen.getByText(/floor, not a total/)).toBeInTheDocument();
  });

  it('renders an empty state for a shop with no sales', async () => {
    getSalesStats.mockResolvedValue({
      orders: { total: 0, confirmed: 0, awaitingPayment: 0, cancelled: 0 },
      revenueMinorByCurrency: {},
      topProducts: [],
      lowStock: [],
      truncated: false,
    });
    render(<DashboardPage />);
    await act(async () => {});
    expect(screen.getByText('No sales yet')).toBeInTheDocument();
  });
});
