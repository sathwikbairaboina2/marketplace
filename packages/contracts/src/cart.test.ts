import {
  CartLineSchema,
  CartResponseSchema,
  MAX_CART_LINES,
  PutCartLineSchema,
} from './cart';

describe('CartLineSchema', () => {
  it('accepts a productId and positive quantity', () => {
    expect(
      CartLineSchema.parse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 2 }),
    ).toEqual({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 2 });
  });

  it('rejects zero and negative quantities', () => {
    expect(CartLineSchema.safeParse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: 0 }).success).toBe(false);
    expect(CartLineSchema.safeParse({ productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV', qty: -1 }).success).toBe(false);
  });

  it('rejects a non-ULID productId', () => {
    expect(CartLineSchema.safeParse({ productId: 'nope', qty: 1 }).success).toBe(false);
  });
});

describe('PutCartLineSchema', () => {
  it('accepts qty 0 (removal)', () => {
    expect(PutCartLineSchema.parse({ qty: 0 })).toEqual({ qty: 0 });
  });
});

describe('CartResponseSchema', () => {
  const line = {
    productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    qty: 2,
    name: 'Mug',
    unitPriceMinor: 1200,
    currency: 'USD',
    image: null,
    stock: 5,
    unavailable: false,
  };

  it('round-trips a resolved cart', () => {
    const cart = { lines: [line], totalMinor: 2400 };
    expect(CartResponseSchema.parse(cart)).toEqual(cart);
  });

  it('caps the number of lines', () => {
    const lines = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({
      ...line,
      productId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}`.slice(0, 26),
    }));
    expect(CartResponseSchema.safeParse({ lines, totalMinor: 0 }).success).toBe(false);
  });
});
