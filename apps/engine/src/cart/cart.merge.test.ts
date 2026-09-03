import { MAX_CART_LINES, MAX_QUANTITY } from '@marketplace/contracts';
import { mergeLines } from './cart.service';

const line = (productId: string, qty: number) => ({ productId, qty });

describe('mergeLines', () => {
  it('keeps the buyer own lines first and appends what the guest carted', () => {
    expect(mergeLines([line('a', 1)], [line('b', 2)])).toEqual([line('a', 1), line('b', 2)]);
  });

  it('adds quantities for a product both carts hold, capped at the maximum', () => {
    expect(mergeLines([line('a', 2)], [line('a', 3)])).toEqual([line('a', 5)]);
    expect(mergeLines([line('a', MAX_QUANTITY - 1)], [line('a', 5)])).toEqual([line('a', MAX_QUANTITY)]);
  });

  it('drops guest lines that would not fit rather than refusing the sign-in', () => {
    const own = Array.from({ length: MAX_CART_LINES }, (_, i) => line(`own-${i}`, 1));
    const merged = mergeLines(own, [line('guest-extra', 1), line('own-0', 1)]);
    expect(merged).toHaveLength(MAX_CART_LINES);
    expect(merged.find((l) => l.productId === 'guest-extra')).toBeUndefined();
    // A product already in the cart still gets its quantity added.
    expect(merged[0]).toEqual(line('own-0', 2));
  });

  it('does not mutate either input', () => {
    const own = [line('a', 1)];
    const guest = [line('a', 1)];
    mergeLines(own, guest);
    expect(own).toEqual([line('a', 1)]);
    expect(guest).toEqual([line('a', 1)]);
  });
});
