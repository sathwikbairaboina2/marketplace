import { describe, expect, it, vi, beforeEach } from 'vitest';

const token = {
  getCart: vi.fn(),
  putCartLine: vi.fn(),
  clearCart: vi.fn(),
  mergeGuestCart: vi.fn(),
  cancelOrder: vi.fn(),
};
vi.mock('../api/cart', () => ({
  getCart: () => token.getCart(),
  putCartLine: (...a: unknown[]) => token.putCartLine(...a),
  clearCart: () => token.clearCart(),
  mergeGuestCart: (...a: unknown[]) => token.mergeGuestCart(...a),
}));
vi.mock('../api/checkout', () => ({ checkout: vi.fn(), payOrder: vi.fn() }));
vi.mock('../api/orders', () => ({
  getOrder: vi.fn(),
  cancelOrder: (...a: unknown[]) => token.cancelOrder(...a),
}));
const pub = {
  guestMint: vi.fn(),
  guestGetCart: vi.fn(),
  guestPutCartLine: vi.fn(),
  guestClearCart: vi.fn(),
  guestCheckout: vi.fn(),
  guestGetOrder: vi.fn(),
  guestPayOrder: vi.fn(),
  guestCancelOrder: vi.fn(),
};
vi.mock('../api/shop', () => ({
  guestMint: (...a: unknown[]) => pub.guestMint(...a),
  guestGetCart: (...a: unknown[]) => pub.guestGetCart(...a),
  guestPutCartLine: (...a: unknown[]) => pub.guestPutCartLine(...a),
  guestClearCart: (...a: unknown[]) => pub.guestClearCart(...a),
  guestCheckout: (...a: unknown[]) => pub.guestCheckout(...a),
  guestGetOrder: (...a: unknown[]) => pub.guestGetOrder(...a),
  guestPayOrder: (...a: unknown[]) => pub.guestPayOrder(...a),
  guestCancelOrder: (...a: unknown[]) => pub.guestCancelOrder(...a),
}));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ principal: null }) }));
vi.mock('./shop-context', () => ({ useShop: () => null }));

import { commerceFor } from './commerce';

const cart = { lines: [], totalMinor: 0 };

beforeEach(() => {
  localStorage.clear();
  for (const fn of [...Object.values(token), ...Object.values(pub)]) fn.mockReset();
});

describe('commerceFor', () => {
  it('is the token routes with a session, wherever the page is', () => {
    const c = commerceFor({ tenantId: 'acme' }, true);
    expect(c.guest).toBe(false);
    void c.getCart();
    expect(token.getCart).toHaveBeenCalled();
    expect(pub.guestMint).not.toHaveBeenCalled();
  });

  it('is the token routes on the platform host even without a session, but asks for no cart', async () => {
    const c = commerceFor(null, false);
    expect(c.guest).toBe(false);
    expect(await c.getCart()).toEqual(cart);
    expect(token.getCart).not.toHaveBeenCalled();
  });

  it('answers an empty cart for a stranger who has no ticket, without minting one', async () => {
    const c = commerceFor({ tenantId: 'acme' }, false);
    expect(c.guest).toBe(true);
    expect(await c.getCart()).toEqual(cart);
    expect(pub.guestMint).not.toHaveBeenCalled();
    expect(pub.guestGetCart).not.toHaveBeenCalled();
  });

  it('mints a ticket on the first write, keeps it, and sends it on every guest call', async () => {
    pub.guestMint.mockResolvedValue('t1.mac');
    pub.guestPutCartLine.mockResolvedValue(cart);
    pub.guestGetCart.mockResolvedValue(cart);
    const c = commerceFor({ tenantId: 'acme' }, false);

    await c.putLine('p1', 2);
    expect(pub.guestMint).toHaveBeenCalledWith('acme');
    expect(pub.guestPutCartLine).toHaveBeenCalledWith('acme', 't1.mac', 'p1', 2);
    expect(c.ticket()).toBe('t1.mac');

    await c.getCart();
    expect(pub.guestGetCart).toHaveBeenCalledWith('acme', 't1.mac');
    expect(pub.guestMint).toHaveBeenCalledTimes(1);
  });

  it('keeps tickets apart per shop', async () => {
    localStorage.setItem('marketplace.guest.acme', 'acme-ticket');
    const globex = commerceFor({ tenantId: 'globex' }, false);
    expect(globex.ticket()).toBeNull();
  });

  it('refuses a guest checkout with no email, and sends it with one', async () => {
    localStorage.setItem('marketplace.guest.acme', 't1.mac');
    pub.guestCheckout.mockResolvedValue({ id: 'o1' });
    const c = commerceFor({ tenantId: 'acme' }, false);
    const body = { currency: 'USD', shippingAddress: { line1: 'x' }, fulfilment: 'delivery' as const, deposit: false, attributes: {} };

    await expect(c.checkout(body, 'key')).rejects.toThrow(/email/);
    await c.checkout(body, 'key', 'a@b.co');
    expect(pub.guestCheckout).toHaveBeenCalledWith('acme', 't1.mac', { ...body, email: 'a@b.co' }, 'key');
  });
});

describe('adoptGuestCart', () => {
  const merged = { lines: [{ productId: 'p1' }], totalMinor: 500 };

  it('folds the ticketed cart into the account and keeps the ticket', async () => {
    localStorage.setItem('marketplace.guest.acme', 'tkt-1');
    token.mergeGuestCart.mockResolvedValue(merged);
    const c = commerceFor({ tenantId: 'acme' }, true);
    expect(await c.adoptGuestCart()).toEqual(merged);
    expect(token.mergeGuestCart).toHaveBeenCalledWith('tkt-1');
    // The ticket is the only key to an order placed as a stranger. Spending it
    // here left an unpaid order that no route could pay for and only the
    // seller could cancel, with its stock reserved. The merge has already
    // emptied the guest cart, so keeping it leaks nothing.
    expect(localStorage.getItem('marketplace.guest.acme')).toBe('tkt-1');
  });

  it('answers null and asks for nothing when there is no ticket', async () => {
    const c = commerceFor({ tenantId: 'acme' }, true);
    expect(await c.adoptGuestCart()).toBeNull();
    expect(token.mergeGuestCart).not.toHaveBeenCalled();
  });

  it('keeps the ticket when the merge fails, and does not throw', async () => {
    localStorage.setItem('marketplace.guest.acme', 'tkt-1');
    token.mergeGuestCart.mockRejectedValue(new Error('nope'));
    const c = commerceFor({ tenantId: 'acme' }, true);
    expect(await c.adoptGuestCart()).toBeNull();
    expect(localStorage.getItem('marketplace.guest.acme')).toBe('tkt-1');
  });

  it('adopts nothing for a stranger, who has no account to adopt into', async () => {
    localStorage.setItem('marketplace.guest.acme', 'tkt-1');
    const c = commerceFor({ tenantId: 'acme' }, false);
    expect(await c.adoptGuestCart()).toBeNull();
    expect(token.mergeGuestCart).not.toHaveBeenCalled();
    expect(localStorage.getItem('marketplace.guest.acme')).toBe('tkt-1');
  });

  it('adopts nothing on the platform host, where no shop names a ticket', async () => {
    const c = commerceFor(null, true);
    expect(await c.adoptGuestCart()).toBeNull();
    expect(token.mergeGuestCart).not.toHaveBeenCalled();
  });
});

describe('the guest order routes carry the lookup email', () => {
  it('sends the email a shopper looked the order up with when paying', async () => {
    localStorage.setItem('marketplace.guest.acme', 'tkt-1');
    const c = commerceFor({ tenantId: 'acme' }, false);
    const card = { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' };
    await c.payOrder('ord-1', card, 'her@example.com');
    expect(pub.guestPayOrder).toHaveBeenCalledWith(
      'acme',
      'tkt-1',
      'ord-1',
      card,
      'her@example.com',
    );
  });

  it('cancels through the shop route, with the email when there is one', async () => {
    localStorage.setItem('marketplace.guest.acme', 'tkt-1');
    const c = commerceFor({ tenantId: 'acme' }, false);
    await c.cancelOrder('ord-1', 'her@example.com');
    expect(pub.guestCancelOrder).toHaveBeenCalledWith('acme', 'tkt-1', 'ord-1', 'her@example.com');
  });

  it('cancels through the token route with a session', async () => {
    const c = commerceFor({ tenantId: 'acme' }, true);
    await c.cancelOrder('ord-1');
    expect(token.cancelOrder).toHaveBeenCalledWith('ord-1');
    expect(pub.guestCancelOrder).not.toHaveBeenCalled();
  });
});
