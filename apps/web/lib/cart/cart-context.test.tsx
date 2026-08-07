import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CartProvider, useCart } from './cart-context';

function Probe() {
  const { lines, add, setQty, remove, clear, idempotencyKey, resetKey } = useCart();
  return (
    <div>
      <span data-testid="count">{lines.length}</span>
      <span data-testid="qty">{lines[0]?.qty ?? 0}</span>
      <span data-testid="key">{idempotencyKey}</span>
      <button onClick={() => add({ productId: 'p1', name: 'P1', priceMinor: 100, qty: 1 })}>
        add
      </button>
      <button onClick={() => add({ productId: 'p2', name: 'P2', priceMinor: 200, qty: 3 })}>
        add2
      </button>
      <button onClick={() => setQty('p1', 5)}>qty</button>
      <button onClick={() => remove('p1')}>remove</button>
      <button onClick={() => clear()}>clear</button>
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
  beforeEach(() => sessionStorage.clear());

  it('merges quantity when the same product is added twice', async () => {
    renderProbe();
    await click('add');
    await click('add');
    expect(screen.getByTestId('count')).toHaveTextContent('1');
    expect(screen.getByTestId('qty')).toHaveTextContent('2');
  });

  it('keeps distinct products as separate lines', async () => {
    renderProbe();
    await click('add');
    await click('add2');
    expect(screen.getByTestId('count')).toHaveTextContent('2');
  });

  it('sets and removes quantities', async () => {
    renderProbe();
    await click('add');
    await click('qty');
    expect(screen.getByTestId('qty')).toHaveTextContent('5');
    await click('remove');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
  });

  it('keeps one idempotency key across the life of an intent', async () => {
    renderProbe();
    await act(async () => {});
    const first = screen.getByTestId('key').textContent;
    expect(first).toBeTruthy();

    await click('add');
    await click('qty');
    // Editing the cart must NOT mint a new key: a retry after a network drop
    // has to reuse it, or the engine creates a second order.
    expect(screen.getByTestId('key')).toHaveTextContent(first!);

    await click('reset');
    expect(screen.getByTestId('key').textContent).not.toBe(first);
  });

  it('persists lines across a remount', async () => {
    const { unmount } = renderProbe();
    await click('add');
    unmount();

    renderProbe();
    await act(async () => {});
    expect(screen.getByTestId('count')).toHaveTextContent('1');
  });

  it('clears the lines but keeps the key until it is explicitly reset', async () => {
    renderProbe();
    await act(async () => {});
    const key = screen.getByTestId('key').textContent;
    await click('add');
    await click('clear');
    expect(screen.getByTestId('count')).toHaveTextContent('0');
    expect(screen.getByTestId('key')).toHaveTextContent(key!);
  });
});
