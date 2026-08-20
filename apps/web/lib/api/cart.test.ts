import { describe, expect, it, vi, beforeEach } from 'vitest';

const request = vi.fn();
vi.mock('./http', () => ({ request: (path: string, opts: unknown) => request(path, opts) }));

import { clearCart, getCart, putCartLine } from './cart';

const empty = { lines: [], totalMinor: 0 };

beforeEach(() => request.mockReset());

describe('cart api client', () => {
  it('reads the cart', async () => {
    request.mockResolvedValueOnce(empty);
    await expect(getCart()).resolves.toEqual(empty);
    expect(request.mock.calls[0][0]).toBe('/cart');
  });

  it('puts one line with PUT and a qty body', async () => {
    request.mockResolvedValueOnce(empty);
    await putCartLine('01ARZ3NDEKTSV4RRFFQ69G5FAV', 3);
    expect(request).toHaveBeenCalledWith(
      '/cart/lines/01ARZ3NDEKTSV4RRFFQ69G5FAV',
      expect.objectContaining({ method: 'PUT', body: { qty: 3 } }),
    );
  });

  it('clears with DELETE', async () => {
    request.mockResolvedValueOnce(empty);
    await clearCart();
    expect(request).toHaveBeenCalledWith('/cart', expect.objectContaining({ method: 'DELETE' }));
  });
});
