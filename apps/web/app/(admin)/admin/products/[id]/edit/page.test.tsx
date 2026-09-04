import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditProductPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
  useRouter: () => ({ push }),
}));

const getProduct = vi.fn();
const updateProduct = vi.fn();
vi.mock('../../../../../../lib/api/products', () => ({
  getProduct: (id: string) => getProduct(id),
  updateProduct: (id: string, patch: unknown) => updateProduct(id, patch),
}));
vi.mock('../../../../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));
vi.mock('../../../../../../lib/problem-notify', () => ({
  notifyProblem: vi.fn(),
  toFormErrors: () => [],
}));

const PRODUCT = {
  entityType: 'Product',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  name: 'Copper Kettle',
  description: 'A kettle of copper',
  priceMinor: 12900,
  currency: 'USD',
  pinned: false,
  category: 'coffee',
  stock: 5,
  images: ['https://example.test/kettle.png'],
  status: 'active',
  createdAt: '2026-08-16T10:00:00.000Z',
  updatedAt: '2026-08-16T10:00:00.000Z',
  attributes: {},
};

beforeEach(() => {
  push.mockReset();
  getProduct.mockReset();
  updateProduct.mockReset();
  getProduct.mockResolvedValue(PRODUCT);
  updateProduct.mockResolvedValue(PRODUCT);
});

describe('EditProductPage', () => {
  it('opens with the product already in the form', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    expect(screen.getByLabelText('Name')).toHaveValue('Copper Kettle');
    expect(screen.getByLabelText('Category')).toHaveValue('coffee');
  });

  // The engine speaks minor units and people do not, exactly as on creation.
  it('shows the price in major units', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    expect(screen.getByLabelText('Price')).toHaveValue('129.00');
  });

  it('sends only what was changed', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    await userEvent.clear(screen.getByLabelText('Name'));
    await userEvent.type(screen.getByLabelText('Name'), 'Copper Kettle II');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateProduct).toHaveBeenCalledWith('01ARZ3NDEKTSV4RRFFQ69G5FAV', {
      name: 'Copper Kettle II',
    });
  });

  it('converts an edited price back into minor units', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    await userEvent.clear(screen.getByLabelText('Price'));
    await userEvent.type(screen.getByLabelText('Price'), '99.50');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateProduct).toHaveBeenCalledWith('01ARZ3NDEKTSV4RRFFQ69G5FAV', { priceMinor: 9950 });
  });

  it('does not send a patch when nothing was touched', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(updateProduct).not.toHaveBeenCalled();
  });

  it('returns to the product once it has saved', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    await userEvent.clear(screen.getByLabelText('Stock'));
    await userEvent.type(screen.getByLabelText('Stock'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(push).toHaveBeenCalledWith('/products/01ARZ3NDEKTSV4RRFFQ69G5FAV');
  });

  // Scoped by src rather than by role: antd renders its icons as role="img"
  // too, so `getByRole('img')` matches the toolbar as well as the photograph.
  it('offers the existing photographs for replacement', async () => {
    const { container } = render(<EditProductPage />);
    await act(async () => {});

    expect(container.querySelector('img[src="https://example.test/kettle.png"]')).not.toBeNull();
  });

  it('says what it is editing rather than showing a bare form', async () => {
    render(<EditProductPage />);
    await act(async () => {});

    expect(screen.getByText(/Copper Kettle/)).toBeInTheDocument();
  });

  it('reports a product that cannot be loaded instead of rendering an empty form', async () => {
    getProduct.mockRejectedValue(new Error('gone'));

    render(<EditProductPage />);
    await act(async () => {});

    expect(screen.queryByLabelText('Name')).toBeNull();
  });
});
