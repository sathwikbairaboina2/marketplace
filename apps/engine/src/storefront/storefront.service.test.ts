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
  const service = new StorefrontService(repo as never);
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

  // The repository returns the raw item, table keys included; the strict
  // contract schema must never see them. This is exactly the 500 the first
  // e2e run produced.
  it('strips the table keys a stored item carries', async () => {
    repo.get.mockResolvedValue({ ...config, PK: 'TENANT#acme', SK: 'SETTINGS#storefront' });
    await expect(service.getPublished()).resolves.toEqual(config);

    repo.get.mockResolvedValue({ ...config, PK: 'p', SK: 's' });
    repo.put.mockResolvedValue(undefined);
    await expect(service.publish()).resolves.toEqual(config);
    expect(repo.put).toHaveBeenCalledWith('SETTINGS#storefront', config);
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

  it('getDraft reports imageGen capability from what is wired in', async () => {
    repo.get.mockResolvedValue(null);
    await expect(service.getDraft()).resolves.toEqual({
      draft: null,
      capabilities: { imageGen: false },
    });
    const enabled = new StorefrontService(
      repo as never,
      { generate: jest.fn() } as never,
      { store: jest.fn() } as never,
    );
    await expect(enabled.getDraft()).resolves.toEqual({
      draft: null,
      capabilities: { imageGen: true },
    });
  });

  it('generateBannerArt 503s when no renderer is wired', async () => {
    await expect(service.generateBannerArt('hero')).rejects.toMatchObject({
      status: 503,
      problem: expect.objectContaining({
        type: 'https://marketplace.local/problems/image-gen-unavailable',
      }),
    });
  });

  it('generateBannerArt renders from the draft profile and stores the result', async () => {
    const generate = jest.fn().mockResolvedValue(Buffer.from([1, 2, 3]));
    const store = jest.fn().mockResolvedValue({ objectUrl: 'http://media.local/banner.png' });
    const enabled = new StorefrontService(
      repo as never,
      { generate } as never,
      { store } as never,
    );
    repo.get.mockResolvedValue(config);

    await expect(enabled.generateBannerArt('hero')).resolves.toEqual({
      imageUrl: 'http://media.local/banner.png',
    });
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('ceramics studio'));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining('Objects with a thumbprint'));
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: 'image/png', originalname: 'banner-hero.png' }),
    );
  });

  it('generateBannerArt 404s when the draft has no banner in that slot', async () => {
    const enabled = new StorefrontService(
      repo as never,
      { generate: jest.fn() } as never,
      { store: jest.fn() } as never,
    );
    repo.get.mockResolvedValue(config);
    await expect(enabled.generateBannerArt('footer')).rejects.toMatchObject({ status: 404 });
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
