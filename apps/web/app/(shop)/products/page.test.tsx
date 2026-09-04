import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import ProductsPage from './page';

const listProducts = vi.fn();
const searchProducts = vi.fn();
vi.mock('../../../lib/api/products', () => ({
  listProducts: (limit: number, cursor: string | null) => listProducts(limit, cursor),
  searchProducts: (body: unknown) => searchProducts(body),
}));
vi.mock('../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));
vi.mock('../../../lib/auth/auth-context', () => ({
  useAuth: () => ({ principal: { tenantId: 'acme', userId: 'u1', role: 'admin' } }),
}));
vi.mock('../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

// The grid keeps its filters in the URL, so a shopper can bookmark a filtered
// shop and a merchant can link to one category. These tests browse unfiltered.
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/products',
  useSearchParams: () => new URLSearchParams(),
}));

const product = (over: Record<string, unknown>) => ({
  entityType: 'Product',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'A product',
  description: 'd',
  priceMinor: 1000,
  currency: 'USD',
  category: 'kitchen',
  stock: 5,
  images: [],
  status: 'active',
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
  attributes: {},
  ...over,
});

beforeEach(() => {
  listProducts.mockReset();
  searchProducts.mockReset();
});

describe('the storefront grid', () => {
  // GET /products returns every status, because the same route serves the
  // seller's own cockpit. The storefront is a shop window: a draft is a
  // half-written listing and an archived product has been withdrawn, and
  // neither belongs in front of a shopper.
  it('does not show a draft product', async () => {
    listProducts.mockResolvedValue({
      items: [
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA1', name: 'Ready for sale', status: 'active' }),
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA2', name: 'Still a draft', status: 'draft' }),
      ],
      nextCursor: null,
    });

    render(<ProductsPage />);
    await act(async () => {});

    expect(screen.getByText('Ready for sale')).toBeInTheDocument();
    expect(screen.queryByText('Still a draft')).toBeNull();
  });

  it('does not show an archived product', async () => {
    listProducts.mockResolvedValue({
      items: [
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA3', name: 'Ready for sale', status: 'active' }),
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA4', name: 'Withdrawn', status: 'archived' }),
      ],
      nextCursor: null,
    });

    render(<ProductsPage />);
    await act(async () => {});

    expect(screen.queryByText('Withdrawn')).toBeNull();
  });

  // Out of stock is a shopper-facing state, not a hidden one: the card stays,
  // marked sold out, which is how the shop shows it is a real shop.
  it('still shows a product that is out of stock', async () => {
    listProducts.mockResolvedValue({
      items: [product({ name: 'Sold out but real', status: 'out_of_stock', stock: 0 })],
      nextCursor: null,
    });

    render(<ProductsPage />);
    await act(async () => {});

    expect(screen.getByText('Sold out but real')).toBeInTheDocument();
  });

  it('counts only what a shopper can see', async () => {
    listProducts.mockResolvedValue({
      items: [
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA5', name: 'One', status: 'active' }),
        product({ id: '01ARZ3NDEKTSV4RRFFQ69G5FA6', name: 'Two', status: 'draft' }),
      ],
      nextCursor: null,
    });

    render(<ProductsPage />);
    await act(async () => {});

    expect(screen.getByText(/^1 product$/)).toBeInTheDocument();
  });

  it('shows the empty state when every product is a draft', async () => {
    listProducts.mockResolvedValue({
      items: [product({ name: 'Hidden', status: 'draft' })],
      nextCursor: null,
    });

    render(<ProductsPage />);
    await act(async () => {});

    expect(screen.getByText(/just getting started/i)).toBeInTheDocument();
  });
});
