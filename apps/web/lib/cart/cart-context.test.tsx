import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';

const getCart = vi.fn();
const putCartLine = vi.fn();
const clearCart = vi.fn();
const adoptGuestCart = vi.fn();
// The binding is the seam now (lib/shop/commerce): the provider talks to
// whichever cart the binding names, and this test names one.
let token: string | null = 'tok-1';
const commerce = {
  guest: false,
  ticket: () => null,
  adoptGuestCart: (...a: unknown[]) => adoptGuestCart(...a),
  getCart: (...a: unknown[]) => (token ? getCart(...a) : Promise.resolve({ lines: [], totalMinor: 0 })),
  putLine: (...a: unknown[]) => putCartLine(...a),
  clearCart: (...a: unknown[]) => clearCart(...a),
};
vi.mock('../shop/commerce', () => ({ useShopCommerce: () => commerce }));

const notifyProblem = vi.fn();
vi.mock('../problem-notify', () => ({ notifyProblem: (e: unknown) => notifyProblem(e) }));

import { CartProvider, useCart } from './cart-context';

const line = (productId: string, qty: number) => ({
  productId,
  qty,
  name: `n-${productId}`,
  unitPriceMinor: 100,
  currency: 'USD',
  image: null,
  stock: 5,
  unavailable: false,
});

function Probe() {
  const { cart, add, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  return (
    <div>
      <span data-testid="count">{cart.lines.length}</span>
      <span data-testid="qty">{cart.lines[0]?.qty ?? 0}</span>
      <span data-testid="total">{cart.totalMinor}</span>
      <span data-testid="key">{idempotencyKey}</span>
      <button onClick={() => void add('p1', 1)}>add</button>
      <button onClick={() => void setQty('p1', 5)}>qty</button>
      <button onClick={() => void remove('p1')}>remove</button>
      <button onClick={() => void clear()}>clear</button>
      <button onClick={() => resetKey()}>reset</button>
    </div>
  );
}

const click = async (label: string) =>
  act(async () => {
    screen.getByText(label).click();
  });

const renderProbe = () =>
  render(
    <CartProvider>
      <Probe />
    </CartProvider>,
  );

describe('CartProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    getCart.mockReset().mockResolvedValue({ lines: [], totalMinor: 0 });
    putCartLine.mockReset();
    clearCart.mockReset();
    adoptGuestCart.mockReset().mockResolvedValue(null);
    notifyProblem.mockReset();
    token = 'tok-1';
  });

  it('fetches the cart on mount when signed in', async () => {
    getCart.mockResolvedValue({ lines: [line('p1', 2)], totalMinor: 200 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(screen.getByTestId('total')).toHaveTextContent('200');
  });

  it('shows the cart a stranger built once sign-in adopts it, without asking for the empty one', async () => {
    adoptGuestCart.mockResolvedValue({ lines: [line('p1', 3)], totalMinor: 300 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    expect(screen.getByTestId('qty')).toHaveTextContent('3');
    // The race this replaced: a fetch beside the merge answered empty last.
    expect(getCart).not.toHaveBeenCalled();
  });

  it('falls back to the account cart when there is nothing to adopt', async () => {
    getCart.mockResolvedValue({ lines: [line('p9', 1)], totalMinor: 100 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('total')).toHaveTextContent('100'));
    expect(adoptGuestCart).toHaveBeenCalled();
  });

  it('does not fetch without a session', async () => {
    token = null;
    renderProbe();
    await act(async () => {});
    expect(getCart).not.toHaveBeenCalled();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('adds by sending the combined quantity and adopting the resolved cart', async () => {
    getCart.mockResolvedValue({ lines: [line('p1', 2)], totalMinor: 200 });
    putCartLine.mockResolvedValue({ lines: [line('p1', 3)], totalMinor: 300 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('qty')).toHaveTextContent('2'));

    await click('add');
    expect(putCartLine).toHaveBeenCalledWith('p1', 3);
    expect(screen.getByTestId('qty')).toHaveTextContent('3');
  });

  it('removes by sending qty 0', async () => {
    getCart.mockResolvedValue({ lines: [line('p1', 2)], totalMinor: 200 });
    putCartLine.mockResolvedValue({ lines: [], totalMinor: 0 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    await click('remove');
    expect(putCartLine).toHaveBeenCalledWith('p1', 0);
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('refetches and reports when a write fails', async () => {
    getCart.mockResolvedValue({ lines: [line('p1', 2)], totalMinor: 200 });
    putCartLine.mockRejectedValue(new Error('boom'));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    await click('qty');
    await waitFor(() => expect(notifyProblem).toHaveBeenCalled());
    // The recovery refetch restored the server's copy.
    expect(getCart.mock.calls.length).toBeGreaterThan(1);
    expect(screen.getByTestId('qty')).toHaveTextContent('2');
  });

  it('keeps one idempotency key across cart edits, until explicitly reset', async () => {
    putCartLine.mockResolvedValue({ lines: [line('p1', 1)], totalMinor: 100 });
    renderProbe();
    await act(async () => {});
    const first = screen.getByTestId('key').textContent;
    expect(first).toBeTruthy();

    await click('add');
    // Editing the cart must NOT mint a new key: a retry after a network drop
    // has to reuse it, or the engine creates a second order.
    expect(screen.getByTestId('key')).toHaveTextContent(first!);

    await click('reset');
    expect(screen.getByTestId('key').textContent).not.toBe(first);
  });

  it('clears through the API', async () => {
    getCart.mockResolvedValue({ lines: [line('p1', 2)], totalMinor: 200 });
    clearCart.mockResolvedValue({ lines: [], totalMinor: 0 });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));

    await click('clear');
    expect(clearCart).toHaveBeenCalled();
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });
});
