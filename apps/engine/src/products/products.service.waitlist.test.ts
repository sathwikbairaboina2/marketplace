import { ProductsService } from './products.service';

const repo = { get: jest.fn(), put: jest.fn(), queryPrefix: jest.fn() };
const notifications = { send: jest.fn() };
const storefront = { getPublished: jest.fn() };
const registry = { validate: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'admin-1', role: 'admin' })),
}));

const product = (over: Record<string, unknown> = {}) => ({
  PK: 'TENANT#acme',
  SK: 'PRODUCT#01ARZ3NDEKTSV4RRFFQ69G5FAV',
  entityType: 'Product',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  status: 'active',
  pinned: false,
  name: 'Speckled Bowl',
  description: 'one of a kind',
  priceMinor: 185_000,
  currency: 'INR',
  category: 'kitchen',
  stock: 0,
  images: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  attributes: {},
  ...over,
});

const waiting = (email: string) => ({
  PK: 'TENANT#acme',
  SK: `WAITLIST#01ARZ3NDEKTSV4RRFFQ69G5FAV#${email}`,
  entityType: 'Waitlist',
  productId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  email,
  createdAt: '2026-09-02T00:00:00.000Z',
});

describe('telling people a one-of-a-kind piece is back', () => {
  const service = new ProductsService(
    repo as never,
    registry as never,
    {} as never,
    notifications as never,
    storefront as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repo.put.mockResolvedValue(undefined);
    registry.validate.mockImplementation((_: string, attrs: unknown) => attrs ?? {});
    storefront.getPublished.mockResolvedValue({ businessProfile: { name: 'Mitti Studio' } });
    repo.queryPrefix.mockResolvedValue({ items: [waiting('her@example.com')], nextCursor: null });
  });

  it('writes to everyone waiting when stock goes from nought to something', async () => {
    repo.get.mockResolvedValue(product({ stock: 0 }));

    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 1 } as never);

    expect(notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'back-in-stock', to: 'her@example.com' }),
    );
  });

  it('says nothing when the merchant edits a product that was never sold out', async () => {
    repo.get.mockResolvedValue(product({ stock: 4 }));

    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 6 } as never);

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('says nothing when a sold-out product is edited but stays sold out', async () => {
    repo.get.mockResolvedValue(product({ stock: 0 }));

    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { description: 'reworded' } as never);

    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('says nothing when the restocked product is not one a shopper can see', async () => {
    repo.get.mockResolvedValue(product({ stock: 0 }));

    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 2, status: 'draft' } as never);

    expect(notifications.send).not.toHaveBeenCalled();
  });

  // A waitlist entry is one question, not a subscription: it is spent on use,
  // so a second restock does not tell the same person twice.
  it('spends the entry, and ignores spent ones next time', async () => {
    repo.get.mockResolvedValue(product({ stock: 0 }));
    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 1 } as never);

    const marker = repo.put.mock.calls.find(([sk]) => String(sk).startsWith('WAITLIST#'));
    expect(marker?.[1]).toMatchObject({ entityType: 'WaitlistSent' });

    jest.clearAllMocks();
    repo.get.mockResolvedValue(product({ stock: 0 }));
    repo.queryPrefix.mockResolvedValue({
      items: [{ ...waiting('her@example.com'), entityType: 'WaitlistSent' }],
      nextCursor: null,
    });
    await service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 1 } as never);
    expect(notifications.send).not.toHaveBeenCalled();
  });

  it('does not fail a restock because the waitlist could not be read', async () => {
    repo.get.mockResolvedValue(product({ stock: 0 }));
    repo.queryPrefix.mockRejectedValue(new Error('table is gone'));

    await expect(
      service.update('01ARZ3NDEKTSV4RRFFQ69G5FAV', { stock: 1 } as never),
    ).resolves.toMatchObject({ stock: 1 });
  });
});
