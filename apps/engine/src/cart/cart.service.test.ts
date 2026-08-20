import { MAX_CART_LINES, ProductRecord } from '@marketplace/contracts';
import { CartService } from './cart.service';
import { cartSk, entitySk } from '../persistence/keys';

const repo = { get: jest.fn(), put: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'user-1', role: 'buyer' })),
}));

const P1 = '01ARZ3NDEKTSV4RRFFQ69G5FA1';
const P2 = '01ARZ3NDEKTSV4RRFFQ69G5FA2';

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    PK: 'TENANT#acme',
    SK: entitySk('Product', overrides.id ?? P1),
    entityType: 'Product',
    id: P1,
    status: 'active',
    name: 'Widget',
    description: 'A widget',
    priceMinor: 500,
    currency: 'USD',
    category: 'widgets',
    stock: 10,
    images: ['https://example.com/widget.png'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    attributes: {},
    ...overrides,
  };
}

describe('CartService', () => {
  const service = new CartService(repo as never);
  beforeEach(() => jest.clearAllMocks());

  it('returns an empty cart for a user with no cart item', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.get()).resolves.toEqual({ lines: [], totalMinor: 0 });
  });

  it('writes one stored line and returns the resolved cart on an empty cart', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return null;
      if (sk === entitySk('Product', P1)) return product({ id: P1 });
      return null;
    });

    const cart = await service.putLine(P1, 2);

    expect(repo.put).toHaveBeenCalledWith(cartSk('user-1'), {
      lines: [{ productId: P1, qty: 2 }],
    });
    expect(cart.lines).toEqual([
      {
        productId: P1,
        qty: 2,
        name: 'Widget',
        unitPriceMinor: 500,
        currency: 'USD',
        image: 'https://example.com/widget.png',
        stock: 10,
        unavailable: false,
      },
    ]);
    expect(cart.totalMinor).toBe(1000);
  });

  it('replaces qty for an already-present product rather than adding', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return { lines: [{ productId: P1, qty: 2 }] };
      if (sk === entitySk('Product', P1)) return product({ id: P1 });
      return null;
    });

    await service.putLine(P1, 5);

    expect(repo.put).toHaveBeenCalledWith(cartSk('user-1'), {
      lines: [{ productId: P1, qty: 5 }],
    });
  });

  it('removes the line when qty is 0', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) {
        return { lines: [{ productId: P1, qty: 2 }, { productId: P2, qty: 1 }] };
      }
      return null;
    });

    const cart = await service.putLine(P1, 0);

    expect(repo.put).toHaveBeenCalledWith(cartSk('user-1'), {
      lines: [{ productId: P2, qty: 1 }],
    });
    expect(cart.lines.find((l) => l.productId === P1)).toBeUndefined();
  });

  it('throws a 404 not-found problem for a product that does not exist in the tenant', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return null;
      if (sk === entitySk('Product', P1)) return null;
      return null;
    });

    await expect(service.putLine(P1, 1)).rejects.toMatchObject({
      status: 404,
      problem: expect.objectContaining({ type: expect.stringContaining('not-found') }),
    });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('throws invalid-request 422 for an inactive/archived product', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return null;
      if (sk === entitySk('Product', P1)) return product({ id: P1, status: 'archived' });
      return null;
    });

    await expect(service.putLine(P1, 1)).rejects.toMatchObject({
      status: 422,
      problem: expect.objectContaining({ type: expect.stringContaining('invalid-request') }),
    });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('throws invalid-request 422 with the cap in the detail past MAX_CART_LINES distinct products', async () => {
    const existingLines = Array.from({ length: MAX_CART_LINES }, (_, i) => ({
      productId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}`,
      qty: 1,
    }));
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return { lines: existingLines };
      if (sk === entitySk('Product', P1)) return product({ id: P1 });
      return null;
    });

    await expect(service.putLine(P1, 1)).rejects.toMatchObject({
      status: 422,
      problem: expect.objectContaining({
        type: expect.stringContaining('invalid-request'),
        detail: expect.stringContaining(String(MAX_CART_LINES)),
      }),
    });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('flags a line whose product was archived and excludes it from the total', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) {
        return { lines: [{ productId: P1, qty: 2 }, { productId: P2, qty: 1 }] };
      }
      if (sk === entitySk('Product', P1)) return product({ id: P1, priceMinor: 500, status: 'active' });
      if (sk === entitySk('Product', P2)) return product({ id: P2, status: 'archived' });
      return null;
    });
    const cart = await service.get();
    expect(cart.lines.find((l) => l.productId === P2)?.unavailable).toBe(true);
    expect(cart.totalMinor).toBe(1000);
  });

  it("flags a line whose product is gone with '(no longer available)' and excludes it from the total", async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) {
        return { lines: [{ productId: P1, qty: 2 }, { productId: P2, qty: 1 }] };
      }
      if (sk === entitySk('Product', P1)) return product({ id: P1, priceMinor: 500, status: 'active' });
      if (sk === entitySk('Product', P2)) return null;
      return null;
    });

    const cart = await service.get();

    const gone = cart.lines.find((l) => l.productId === P2);
    expect(gone?.unavailable).toBe(true);
    expect(gone?.name).toBe('(no longer available)');
    expect(cart.totalMinor).toBe(1000);
  });

  it('sums unitPriceMinor * qty over available lines for totalMinor', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) {
        return { lines: [{ productId: P1, qty: 3 }, { productId: P2, qty: 2 }] };
      }
      if (sk === entitySk('Product', P1)) return product({ id: P1, priceMinor: 500, status: 'active' });
      if (sk === entitySk('Product', P2)) return product({ id: P2, priceMinor: 250, status: 'active' });
      return null;
    });

    const cart = await service.get();

    expect(cart.totalMinor).toBe(3 * 500 + 2 * 250);
  });

  it('empties the cart on clear', async () => {
    const cart = await service.clear();

    expect(repo.put).toHaveBeenCalledWith(cartSk('user-1'), { lines: [] });
    expect(cart).toEqual({ lines: [], totalMinor: 0 });
  });

  it('exposes the stored lines unresolved via rawLines for checkout to consume', async () => {
    repo.get.mockImplementation(async (sk: string) => {
      if (sk === cartSk('user-1')) return { lines: [{ productId: P1, qty: 2 }] };
      return null;
    });

    await expect(service.rawLines()).resolves.toEqual([{ productId: P1, qty: 2 }]);
  });
});
