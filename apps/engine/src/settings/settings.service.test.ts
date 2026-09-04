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

describe('what the settings service puts on the wire', () => {
  // The single table stores PK and SK on every item, and this codebase holds
  // that the key scheme is never client-visible. It is not only a leak: the
  // browser parses the deposit policy with a `.strict()` schema, so the extra
  // keys made the whole response invalid and the cart silently stopped
  // offering a deposit.
  const service = new SettingsService(repo as never);

  beforeEach(() => jest.clearAllMocks());

  it('returns a contact with no persistence keys on it', async () => {
    repo.get.mockResolvedValue({
      PK: 'TENANT#acme',
      SK: 'SETTINGS#contact',
      email: 'hello@mitti.in',
      phone: '+91 98765 43210',
      whatsapp: '',
      address: '12 Karve Road',
      delivery: 'Posted in 3 days',
      returns: '7 days',
    });

    const contact = await service.getContact();

    expect(contact).not.toHaveProperty('PK');
    expect(contact).not.toHaveProperty('SK');
    expect(contact.email).toBe('hello@mitti.in');
  });

  it('returns a deposit policy with no persistence keys on it', async () => {
    repo.get.mockResolvedValue({
      PK: 'TENANT#acme',
      SK: 'SETTINGS#deposit',
      enabled: true,
      percent: 50,
      minOrderMinor: 200_000,
    });

    const policy = await service.getDepositPolicy();

    expect(policy).toEqual({ enabled: true, percent: 50, minOrderMinor: 200_000 });
  });

  it('fills a field a stored record predates, rather than answering undefined', async () => {
    repo.get.mockResolvedValue({ PK: 'x', SK: 'y', enabled: true });

    const policy = await service.getDepositPolicy();

    expect(policy.percent).toBe(50);
    expect(policy.minOrderMinor).toBeGreaterThan(0);
  });
});
