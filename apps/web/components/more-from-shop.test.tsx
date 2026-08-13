import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MoreFromShop } from './more-from-shop';

// Inside the factory, not top-level: vi.mock is hoisted above imports and
// cannot close over module-scope helpers.
vi.mock('../lib/api/products', () => {
  const product = (id: string) => ({
    entityType: 'Product',
    id,
    status: 'active',
    name: `P ${id}`,
    description: '',
    priceMinor: 1000,
    currency: 'USD',
    category: 'tools',
    stock: 3,
    images: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    attributes: {},
  });
  return {
    listProducts: vi.fn().mockResolvedValue({
      items: [product('a'), product('b'), product('c')],
      nextCursor: null,
    }),
  };
});

describe('MoreFromShop', () => {
  it('shows the shop’s other products and never the one being viewed', async () => {
    render(<MoreFromShop excludeId="a" />);
    expect(await screen.findByText('P b')).toBeInTheDocument();
    expect(screen.getByText('P c')).toBeInTheDocument();
    expect(screen.queryByText('P a')).not.toBeInTheDocument();
  });

  it('names the section for what it is', async () => {
    render(<MoreFromShop excludeId="a" />);
    expect(await screen.findByText('More from this shop')).toBeInTheDocument();
  });
});
