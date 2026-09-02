import { runWithTenant } from '../common/tenant-context';
import { ProductsService, VISIBLE_TO_SHOPPERS } from './products.service';

const record = (status: string) => ({
  PK: 'TENANT#t',
  SK: 'PRODUCT#p1',
  entityType: 'Product',
  id: 'p1',
  status,
  name: 'Mug',
  description: '',
  priceMinor: 100,
  currency: 'USD',
  category: 'mugs',
  stock: 1,
  images: [],
  attributes: {},
  createdAt: 'x',
  updatedAt: 'x',
  search: 'mug',
});

const principal = { tenantId: 't', userId: 'anonymous', role: 'public' };

function service(found: Record<string, unknown> | null) {
  const repo = { get: jest.fn().mockResolvedValue(found), queryPrefix: jest.fn() };
  const provider = { search: jest.fn() };
  return { svc: new ProductsService(repo as never, {} as never, provider as never), repo, provider };
}

describe('shopper visibility', () => {
  it('names exactly the two statuses a shopper may see', () => {
    expect([...VISIBLE_TO_SHOPPERS]).toEqual(['active', 'out_of_stock']);
  });

  it('returns a visible product without table keys', async () => {
    const { svc } = service(record('out_of_stock'));
    const got = await runWithTenant(principal, () => svc.getVisible('p1'));
    expect(got.id).toBe('p1');
    expect('PK' in got).toBe(false);
    expect('search' in got).toBe(false);
  });

  it.each(['draft', 'archived'])('answers not-found for a %s product', async (status) => {
    const { svc } = service(record(status));
    await expect(runWithTenant(principal, () => svc.getVisible('p1'))).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('answers the same not-found for a product that does not exist', async () => {
    const { svc } = service(null);
    await expect(runWithTenant(principal, () => svc.getVisible('p1'))).rejects.toMatchObject({
      problem: { status: 404 },
    });
  });

  it('lists with the status filter in the query', async () => {
    const { svc, repo } = service(null);
    repo.queryPrefix.mockResolvedValue({ items: [], nextCursor: null });
    await runWithTenant(principal, () => svc.listVisible(10, null));
    const opts = repo.queryPrefix.mock.calls[0]![1] as { filter: { expression: string } };
    expect(opts.filter.expression).toBe('#f0 IN (:v0, :v1)');
  });

  it('searches with the visible statuses forced', async () => {
    const { svc, provider } = service(null);
    provider.search.mockResolvedValue({ items: [], nextCursor: null });
    await runWithTenant(principal, () =>
      svc.searchVisible({ attributes: {}, limit: 25, cursor: null, status: 'draft' }),
    );
    expect(provider.search.mock.calls[0]![1]).toEqual({ statuses: VISIBLE_TO_SHOPPERS });
  });
});
