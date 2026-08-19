import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OrderDetailPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'ord-1' }) }));

const getOrder = vi.fn();
const getProduct = vi.fn();
vi.mock('../../../../lib/api/orders', () => ({
  getOrder: (id: string) => getOrder(id),
  cancelOrder: (id: string) => cancelOrder(id),
}));
vi.mock('../../../../lib/api/products', () => ({ getProduct: (id: string) => getProduct(id) }));
vi.mock('../../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

const listMessages = vi.fn();
const cancelOrder = vi.fn();
vi.mock('../../../../lib/api/messages', () => ({
  listMessages: (id: string, limit: number, cursor: string | null) =>
    listMessages(id, limit, cursor),
  postMessage: vi.fn(),
}));

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
  pipelineVersion: 2,
  stages: [
    { id: 'st-1', name: 'On the bench', cancellable: true, messaging: true },
    { id: 'st-2', name: 'Dispatched', cancellable: false, messaging: false },
  ],
  currentStageId: 'st-1',
  stageEnteredAt: '2026-08-16T12:00:00.000Z',
};

/** The same order sitting in a different stage, or in a different state. */
const orderAt = (over: Record<string, unknown>) => ({ ...ORDER, ...over });

beforeEach(() => {
  getOrder.mockReset();
  getProduct.mockReset();
  getOrder.mockResolvedValue(ORDER);
  listMessages.mockReset();
  listMessages.mockResolvedValue({ items: [], nextCursor: null });
  cancelOrder.mockReset();
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

  it('renders the stages the order was placed under, whatever they are called', async () => {
    render(<OrderDetailPage />);
    await act(async () => {});

    expect(screen.getByText('On the bench')).toBeInTheDocument();
    expect(screen.getByText('Dispatched')).toBeInTheDocument();
  });

  it('offers cancellation while the current stage allows it', async () => {
    render(<OrderDetailPage />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: /cancel order/i })).toBeInTheDocument();
  });

  // The owner decides where the point of no return is, and the order carries
  // that decision with it.
  it('withholds cancellation once the order reaches a stage that forbids it', async () => {
    getOrder.mockResolvedValue(orderAt({ currentStageId: 'st-2' }));

    render(<OrderDetailPage />);
    await act(async () => {});

    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });

  it('offers a composer only on a stage with messaging switched on', async () => {
    render(<OrderDetailPage />);
    await act(async () => {});
    expect(screen.getByPlaceholderText(/write a message/i)).toBeInTheDocument();

    getOrder.mockResolvedValue(orderAt({ currentStageId: 'st-2' }));
    render(<OrderDetailPage />);
    await act(async () => {});
    expect(screen.getAllByPlaceholderText(/write a message/i)).toHaveLength(1);
  });

  it('shows a cancelled order as stopped at its stage', async () => {
    getOrder.mockResolvedValue(orderAt({ status: 'cancelled' }));

    render(<OrderDetailPage />);
    await act(async () => {});

    expect(screen.getByText(/cancelled at On the bench/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel order/i })).toBeNull();
  });
});
