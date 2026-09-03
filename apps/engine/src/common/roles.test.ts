import { assertAdmin } from './roles';

jest.mock('./tenant-context', () => ({ currentPrincipal: jest.fn() }));
import { currentPrincipal } from './tenant-context';

const as = (role: string) =>
  (currentPrincipal as jest.Mock).mockReturnValue({ tenantId: 'acme', userId: 'u1', role });

describe('assertAdmin', () => {
  it('lets an admin through', () => {
    as('admin');
    expect(() => assertAdmin('do the thing')).not.toThrow();
  });

  it('refuses a buyer with a 403 that names the action', () => {
    as('buyer');
    let thrown: unknown;
    try {
      assertAdmin('list the shop orders');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject({
      problem: { status: 403, type: expect.stringContaining('forbidden'), title: 'Only an admin can list the shop orders' },
    });
  });

  it('refuses the public principal too', () => {
    as('public');
    expect(() => assertAdmin('read shop statistics')).toThrow();
  });
});
