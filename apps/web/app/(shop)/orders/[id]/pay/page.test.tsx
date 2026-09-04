import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import PayPage from './page';

const push = vi.fn();
const replace = vi.fn();
// No `?email=`: this is a signed-in buyer, who reaches the order by its id.
// The guest-with-a-lookup-email path is covered in lib/shop/commerce.test.ts.
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'ord-1' }),
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const getOrder = vi.fn();
vi.mock('../../../../../lib/api/orders', () => ({ getOrder: (id: string) => getOrder(id) }));

const payOrder = vi.fn();
vi.mock('../../../../../lib/api/checkout', () => ({
  payOrder: (id: string, card: unknown) => payOrder(id, card),
}));
// The page reaches both through the commerce binding (lib/shop/commerce);
// this test binds it to the token routes above, as a signed-in buyer has.
// One object for the whole test: the page keys its fetch effect on the
// binding, and a fresh object per render would refetch for ever.
vi.mock('../../../../../lib/shop/commerce', () => {
  const commerce = {
    guest: false,
    getOrder: (id: string) => getOrder(id),
    payOrder: (id: string, card: unknown) => payOrder(id, card),
  };
  return { useShopCommerce: () => commerce };
});

vi.mock('../../../../../lib/shop/shop-context', () => ({ useShop: () => null }));

import { ProblemError } from '../../../../../lib/api/http';

const ORDER = {
  entityType: 'Order',
  id: 'ord-1',
  reference: 'K7QY-3PX2',
  fulfilment: 'delivery',
  balanceDueMinor: 0,
  userId: 'u1',
  status: 'awaiting_payment',
  totalAmountMinor: 2400,
  currency: 'USD',
  items: [{ productId: '01KZERNS77Z1E2HB509WV80MN6', quantity: 2, unitPriceMinor: 1200 }],
  shippingAddress: { line1: 'x' },
  createdAt: '2026-08-20T12:00:00.000Z',
  attributes: {},
  pipelineVersion: 1,
  stages: [{ id: 'st-1', name: 'Packing', cancellable: true, messaging: false }],
  currentStageId: null,
  stageEnteredAt: '2026-08-20T12:00:00.000Z',
};

const fill = (number: string) => {
  fireEvent.change(screen.getByTestId('card-number'), { target: { value: number } });
  fireEvent.change(screen.getByTestId('card-month'), { target: { value: '12' } });
  fireEvent.change(screen.getByTestId('card-year'), { target: { value: '2030' } });
  fireEvent.change(screen.getByTestId('card-cvc'), { target: { value: '123' } });
};

/**
 * UPI is the default now — nobody in this market pays for a mug by card — so
 * the card cases start by choosing the card tab.
 */
const chooseCard = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: /card/i }));
  });
  // antd connects the `useForm` instance to the form element on the render
  // after it mounts; without this tick `form.setFields` is a silent no-op and
  // the inline card error never appears.
  await act(async () => {});
};

beforeEach(() => {
  getOrder.mockReset().mockResolvedValue(ORDER);
  payOrder.mockReset();
  push.mockReset();
  replace.mockReset();
});

describe('PayPage', () => {
  it('offers UPI first, because that is how this market pays', async () => {
    render(<PayPage />);
    await act(async () => {});
    expect(screen.getByTestId('upi-vpa')).toBeInTheDocument();
    expect(screen.queryByTestId('card-number')).not.toBeInTheDocument();
    expect(screen.getByTestId('upi-pay')).toHaveTextContent('24.00');
  });

  it('renders the card form with the amount to pay', async () => {
    render(<PayPage />);
    await act(async () => {});
    await chooseCard();
    expect(screen.getByTestId('card-number')).toBeInTheDocument();
    expect(screen.getByTestId('pay-now')).toHaveTextContent('24.00');
  });

  it('blocks a Luhn-invalid number with an inline error, no round trip', async () => {
    render(<PayPage />);
    await act(async () => {});
    await chooseCard();
    fill('4242 4242 4242 4241');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pay-now'));
    });
    expect(payOrder).not.toHaveBeenCalled();
    expect(await screen.findByText('Not a valid card number')).toBeInTheDocument();
  });

  it('pays and navigates to the tracker', async () => {
    payOrder.mockResolvedValue({ ...ORDER, status: 'confirmed', currentStageId: 'st-1' });
    render(<PayPage />);
    await act(async () => {});
    await chooseCard();
    fill('4242 4242 4242 4242');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pay-now'));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders/ord-1'));
    // The schema-normalized number went over the wire, never the spaced one.
    expect(payOrder.mock.calls[0][1].number).toBe('4242424242424242');
  });

  it('renders a decline inline and keeps the form for another card', async () => {
    payOrder.mockRejectedValue(
      new ProblemError(
        'https://marketplace.local/problems/payment-declined',
        402,
        'Card declined',
        'the card was declined; try a different card',
        undefined,
        [],
      ),
    );
    render(<PayPage />);
    await act(async () => {});
    await chooseCard();
    fill('4000 0000 0000 0002');
    await act(async () => {
      fireEvent.click(screen.getByTestId('pay-now'));
    });
    expect(await screen.findByTestId('pay-problem')).toHaveTextContent('Card declined');
    expect(screen.getByTestId('card-number')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('redirects a paid order to the tracker instead of showing a dead form', async () => {
    getOrder.mockResolvedValue({ ...ORDER, status: 'confirmed', currentStageId: 'st-1' });
    render(<PayPage />);
    await act(async () => {});
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/orders/ord-1'));
  });
});
