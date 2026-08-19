import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import OrdersPage from './page';

const listOrders = vi.fn();
vi.mock('../../../lib/api/orders', () => ({
  listOrders: (limit: number, cursor: string | null) => listOrders(limit, cursor),
}));
vi.mock('../../../components/record-name', () => ({
  ProductName: ({ id }: { id: string }) => <span>{id}</span>,
}));

const order = (over: Record<string, unknown> = {}) => ({
  entityType: 'Order',
  id: '01KZERNTAAAB5DFVYVK11QEX9N',
  userId: 'u1',
  status: 'confirmed',
  totalAmountMinor: 2_400,
  currency: 'USD',
  items: [{ productId: '01KZERNS77Z1E2HB509WV80MN6', quantity: 1, unitPriceMinor: 2_400 }],
  shippingAddress: { line1: '42 Harbour Road' },
  createdAt: '2026-08-16T12:00:00.000Z',
  attributes: {},
  pipelineVersion: 3,
  stages: [
    { id: 'st-1', name: 'Awaiting artwork', cancellable: true, messaging: false },
    { id: 'st-2', name: 'Mount cut', cancellable: false, messaging: false },
  ],
  currentStageId: 'st-2',
  stageEnteredAt: '2026-08-16T12:00:00.000Z',
  ...over,
});

beforeEach(() => {
  listOrders.mockReset();
});

describe('OrdersPage', () => {
  it('says which stage each order is in', async () => {
    listOrders.mockResolvedValue({ items: [order()], nextCursor: null });

    render(<OrdersPage />);
    await act(async () => {});

    expect(screen.getByText('Mount cut')).toBeInTheDocument();
  });

  // The name comes from the row's own snapshot, so two orders placed under
  // different pipeline versions each show the stage they were placed with --
  // which a shared pipeline fetch could not do.
  it('names each order stage from that order own snapshot', async () => {
    const older = order({
      id: '01KZERNTBBBB5DFVYVK11QEX9N',
      stages: [{ id: 'old-1', name: 'Packing', cancellable: true, messaging: false }],
      currentStageId: 'old-1',
      pipelineVersion: 1,
    });
    listOrders.mockResolvedValue({ items: [order(), older], nextCursor: null });

    render(<OrdersPage />);
    await act(async () => {});

    expect(screen.getByText('Mount cut')).toBeInTheDocument();
    expect(screen.getByText('Packing')).toBeInTheDocument();
  });

  it('falls back to a dash when the current stage is not in the snapshot', async () => {
    listOrders.mockResolvedValue({
      items: [order({ currentStageId: 'gone' })],
      nextCursor: null,
    });

    render(<OrdersPage />);
    await act(async () => {});

    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
