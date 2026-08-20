import { StorefrontConfig } from '@marketplace/contracts';
import { StorefrontService } from './storefront.service';

const repo = { get: jest.fn(), put: jest.fn() };

jest.mock('../common/tenant-context', () => ({
  currentPrincipal: jest.fn(() => ({ tenantId: 'acme', userId: 'u1', role: 'admin' })),
}));
import { currentPrincipal } from '../common/tenant-context';

const config: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [{ heading: 'Our studio', body: 'Small-batch ceramics.' }],
  },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware and wood, signed by the maker.',
      cta: { label: 'Browse the shelf', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: {
    kind: 'ceramics studio',
    name: 'Kiln & Loom',
    tone: 'warm, personal',
    audience: 'gift shoppers',
  },
};

const asBuyer = () =>
  (currentPrincipal as jest.Mock).mockReturnValueOnce({
    tenantId: 'acme',
    userId: 'u1',
    role: 'buyer',
  });

describe('StorefrontService', () => {
  const service = new StorefrontService(repo as never, false);
  beforeEach(() => jest.clearAllMocks());

  it('getPublished returns null when the tenant has no config', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getPublished()).resolves.toBeNull();
    expect(repo.get).toHaveBeenCalledWith('SETTINGS#storefront');
  });

  it('getPublished parses and returns a stored config', async () => {
    repo.get.mockResolvedValue(config);
    await expect(service.getPublished()).resolves.toEqual(config);
  });

  it('putDraft rejects a non-admin with a 403 problem', async () => {
    asBuyer();
    await expect(service.putDraft(config)).rejects.toMatchObject({ status: 403 });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('putDraft stores the config under SETTINGS#storefront-draft', async () => {
    repo.put.mockResolvedValue(undefined);
    await expect(service.putDraft(config)).resolves.toEqual(config);
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#storefront-draft', config);
  });

  it('publish copies draft over published and returns it', async () => {
    repo.get.mockResolvedValue(config);
    repo.put.mockResolvedValue(undefined);
    await expect(service.publish()).resolves.toEqual(config);
    expect(repo.get).toHaveBeenCalledWith('SETTINGS#storefront-draft');
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#storefront', config);
  });

  it('publish with no draft throws storefront-draft-not-found (404)', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.publish()).rejects.toMatchObject({
      status: 404,
      problem: expect.objectContaining({
        type: 'https://marketplace.local/problems/storefront-draft-not-found',
      }),
    });
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('getDraft reports imageGen capability from its constructor flag', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getDraft()).resolves.toEqual({
      draft: null,
      capabilities: { imageGen: false },
    });
    const enabled = new StorefrontService(repo as never, true);
    await expect(enabled.getDraft()).resolves.toEqual({
      draft: null,
      capabilities: { imageGen: true },
    });
  });

  it('getDraft rejects a non-admin with a 403 problem', async () => {
    asBuyer();
    await expect(service.getDraft()).rejects.toMatchObject({ status: 403 });
  });

  it('getOnboardingFlag defaults to { dismissed: false } when absent', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getOnboardingFlag()).resolves.toEqual({ dismissed: false });
    expect(repo.get).toHaveBeenCalledWith('SETTINGS#storefront-onboarding');
  });

  it('putOnboardingFlag stores and echoes the flag', async () => {
    repo.put.mockResolvedValue(undefined);
    await expect(service.putOnboardingFlag({ dismissed: true })).resolves.toEqual({
      dismissed: true,
    });
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#storefront-onboarding', { dismissed: true });
  });

  it('putOnboardingFlag rejects a non-admin with a 403 problem', async () => {
    asBuyer();
    await expect(service.putOnboardingFlag({ dismissed: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(repo.put).not.toHaveBeenCalled();
  });
});
