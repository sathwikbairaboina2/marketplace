import { currentPrincipal } from '../common/tenant-context';
import { ShopScope } from './shop-scope';

describe('ShopScope', () => {
  const scope = new ShopScope();

  it('binds a public principal for the tenant while fn runs', async () => {
    const seen = await scope.run('acme', async () => currentPrincipal());
    expect(seen).toEqual({ tenantId: 'acme', userId: 'anonymous', role: 'public' });
  });

  it.each(['', 'a b', 'TENANT#x', 'a/b', 'x'.repeat(65)])(
    'answers not-found for the malformed id %j',
    async (bad) => {
      const fn = jest.fn(async () => 1);
      await expect(scope.run(bad, fn)).rejects.toMatchObject({
        problem: { status: 404, type: 'https://marketplace.local/problems/not-found' },
      });
      expect(fn).not.toHaveBeenCalled();
    },
  );

  it('leaves no tenant context behind', async () => {
    await scope.run('acme', async () => 1);
    expect(() => currentPrincipal()).toThrow(/no tenant context/);
  });
});
