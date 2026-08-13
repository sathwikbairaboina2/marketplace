import { SettingsService } from './settings.service';

const repo = { get: jest.fn(), put: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '../common/tenant-context';

describe('SettingsService', () => {
  const service = new SettingsService(repo as never);
  beforeEach(() => jest.clearAllMocks());

  it('defaults to a silent announcement when none is stored', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getAnnouncement()).resolves.toEqual({ text: '', enabled: false });
  });

  it('stores and returns the seller’s line', async () => {
    repo.put.mockResolvedValue(undefined);
    await expect(
      service.updateAnnouncement({ text: 'Launch week', enabled: true }),
    ).resolves.toEqual({ text: 'Launch week', enabled: true });
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#announcement', {
      text: 'Launch week',
      enabled: true,
    });
  });

  it('refuses a non-admin', async () => {
    (currentPrincipal as jest.Mock).mockReturnValueOnce({
      tenantId: 'acme',
      userId: 'u1',
      role: 'buyer',
    });
    await expect(service.updateAnnouncement({ text: 'x', enabled: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(repo.put).not.toHaveBeenCalled();
  });
});
