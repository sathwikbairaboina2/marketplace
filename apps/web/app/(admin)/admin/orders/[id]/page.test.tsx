import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminOrderDetailPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'ord-1' }) }));

const getOrder = vi.fn();
const advanceOrder = vi.fn();
const listMessages = vi.fn();
vi.mock('../../../../../lib/api/orders', () => ({
  getOrder: (id: string) => getOrder(id),
  advanceOrder: (id: string, stageId: string) => advanceOrder(id, stageId),
}));
vi.mock('../../../../../lib/api/messages', () => ({
  listWholeThread: (id: string) => listMessages(id),
  postMessage: vi.fn(),
}));
vi.mock('../../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

const ORDER = {
  entityType: 'Order',
  id: 'ord-1',
  userId: 'u1',
  status: 'confirmed',
  totalAmountMinor: 2_400,
  currency: 'USD',
  items: [{ productId: '01KZERNS77Z1E2HB509WV80MN6', quantity: 1, unitPriceMinor: 2_400 }],
  shippingAddress: { line1: '42 Harbour Road' },
  createdAt: '2026-08-16T12:00:00.000Z',
  attributes: {},
  pipelineVersion: 2,
  stages: [
    { id: 'st-1', name: 'Awaiting artwork', cancellable: true, messaging: true },
    { id: 'st-2', name: 'Mount cut', cancellable: false, messaging: false },
  ],
  currentStageId: 'st-1',
  stageEnteredAt: '2026-08-16T12:00:00.000Z',
};

const orderAt = (over: Record<string, unknown>) => ({ ...ORDER, ...over });

beforeEach(() => {
  getOrder.mockReset();
  advanceOrder.mockReset();
  listMessages.mockReset();
  getOrder.mockResolvedValue(ORDER);
  listMessages.mockResolvedValue({ items: [], truncated: false });
  advanceOrder.mockResolvedValue(orderAt({ currentStageId: 'st-2' }));
});

describe('AdminOrderDetailPage', () => {
  // Found by clicking: the line-item link pointed at /admin/products/:id,
  // a route that does not exist; the editor lives one segment further on.
  it('links each line item to the product editor, not a 404', async () => {
    render(<AdminOrderDetailPage />);
    await act(async () => {});

    const link = screen.getByRole('link', { name: /80MN6/ });
    expect(link).toHaveAttribute('href', '/admin/products/01KZERNS77Z1E2HB509WV80MN6/edit');
  });

  // The button names the shop's own next stage rather than saying "advance":
  // the stages are the owner's words, and the seller is confirming what they
  // have physically done.
  it('names the next stage on the advance button', async () => {
    render(<AdminOrderDetailPage />);
    await act(async () => {});

    expect(screen.getByRole('button', { name: /advance to Mount cut/i })).toBeInTheDocument();
  });

  it('sends the stage the seller was looking at', async () => {
    render(<AdminOrderDetailPage />);
    await act(async () => {});

    await userEvent.click(screen.getByRole('button', { name: /advance to Mount cut/i }));

    // Not the order's stage as the server has it -- the one on screen. That is
    // what lets the engine refuse a stale page instead of skipping a stage.
    await waitFor(() => expect(advanceOrder).toHaveBeenCalledWith('ord-1', 'st-1'));
  });

  it('offers no advance on the final stage', async () => {
    getOrder.mockResolvedValue(orderAt({ currentStageId: 'st-2' }));

    render(<AdminOrderDetailPage />);
    await act(async () => {});

    expect(screen.queryByRole('button', { name: /advance/i })).toBeNull();
  });

  // A shop that never configured its stages has exactly one, so every advance
  // is a legitimate 409. The seller should meet that as a missing button.
  it('offers no advance in a shop with a single stage', async () => {
    getOrder.mockResolvedValue(
      orderAt({
        stages: [{ id: 'only', name: 'Confirmed', cancellable: true, messaging: false }],
        currentStageId: 'only',
      }),
    );

    render(<AdminOrderDetailPage />);
    await act(async () => {});

    expect(screen.queryByRole('button', { name: /advance/i })).toBeNull();
  });

  it('offers no advance on a cancelled order', async () => {
    getOrder.mockResolvedValue(orderAt({ status: 'cancelled' }));

    render(<AdminOrderDetailPage />);
    await act(async () => {});

    expect(screen.queryByRole('button', { name: /advance/i })).toBeNull();
    expect(screen.getByText(/cancelled at Awaiting artwork/i)).toBeInTheDocument();
  });

  it('gives the seller the thread on a messaging stage', async () => {
    render(<AdminOrderDetailPage />);
    await act(async () => {});

    expect(screen.getByPlaceholderText(/write a message/i)).toBeInTheDocument();
  });
});
