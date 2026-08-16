import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OrderDetailPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'ord-1' }) }));

const getOrder = vi.fn();
const getProduct = vi.fn();
vi.mock('../../../../lib/api/orders', () => ({ getOrder: (id: string) => getOrder(id) }));
vi.mock('../../../../lib/api/products', () => ({ getProduct: (id: string) => getProduct(id) }));
vi.mock('../../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

const MUG = '01KZERNS77Z1E2HB509WV80MN6';
const KETTLE = '01KZERNSCDRB5DFVYVK11QEX9N';

const ORDER = {
  entityType: 'Order',
  id: '01KZERNTAAAB5DFVYVK11QEX9N',
  userId: 'u1',
  status: 'confirmed',
  totalAmountMinor: 15_300,
  currency: 'USD',
  items: [
    { productId: MUG, quantity: 1, unitPriceMinor: 2_400 },
    { productId: KETTLE, quantity: 1, unitPriceMinor: 12_900 },
  ],
  shippingAddress: { line1: '42 Harbour Road', city: 'Bristol', postcode: 'BS1 4TR' },
  createdAt: '2026-08-16T12:00:00.000Z',
  attributes: {},
};

beforeEach(() => {
  getOrder.mockReset();
  getProduct.mockReset();
  getOrder.mockResolvedValue(ORDER);
});

describe('OrderDetailPage', () => {
  it('names the products it ordered rather than showing their ids', async () => {
    getProduct.mockImplementation((id: string) =>
      Promise.resolve({ id, name: id === MUG ? 'Coupe Stoneware Mug' : 'Copper Gooseneck Kettle' }),
    );

    render(<OrderDetailPage />);
    await act(async () => {});

    expect(screen.getByText('Coupe Stoneware Mug')).toBeInTheDocument();
    expect(screen.getByText('Copper Gooseneck Kettle')).toBeInTheDocument();
    // The full ULID was the whole cell. It is a reference, not a name.
    expect(screen.queryByText(MUG)).toBeNull();
    expect(screen.queryByText(KETTLE)).toBeNull();
  });

  it('falls back to a reference for a product that cannot be fetched', async () => {
    getProduct.mockRejectedValue(new Error('gone'));

    render(<OrderDetailPage />);
    await act(async () => {});

    // A deleted or unreachable product must not take the order down with it.
    expect(screen.getByText('Order')).toBeInTheDocument();
    expect(screen.getByTitle(MUG)).toBeInTheDocument();
    expect(screen.getByTitle(KETTLE)).toBeInTheDocument();
  });
});
