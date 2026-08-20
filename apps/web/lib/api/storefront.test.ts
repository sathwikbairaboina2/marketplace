import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StorefrontConfig } from '@marketplace/contracts';

const request = vi.fn();
vi.mock('./http', () => ({ request: (path: string, opts: unknown) => request(path, opts) }));

import {
  getPublishedStorefront,
  publishStorefront,
  putOnboardingFlag,
  putStorefrontDraft,
} from './storefront';

const config: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: { title: 't', sections: [{ heading: 'h', body: 'b' }] },
  banners: [],
  businessProfile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
};

beforeEach(() => request.mockReset());

describe('storefront api client', () => {
  it('unwraps the published-config envelope, null included', async () => {
    request.mockResolvedValueOnce({ config: null });
    await expect(getPublishedStorefront()).resolves.toBeNull();
    expect(request.mock.calls[0][0]).toBe('/storefront');

    request.mockResolvedValueOnce({ config });
    await expect(getPublishedStorefront()).resolves.toEqual(config);
  });

  it('writes the draft with PUT and the full document', async () => {
    request.mockResolvedValueOnce(config);
    await putStorefrontDraft(config);
    expect(request).toHaveBeenCalledWith(
      '/storefront/draft',
      expect.objectContaining({ method: 'PUT', body: config }),
    );
  });

  it('publishes with POST', async () => {
    request.mockResolvedValueOnce(config);
    await publishStorefront();
    expect(request).toHaveBeenCalledWith(
      '/storefront/publish',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('writes the dismissal flag', async () => {
    request.mockResolvedValueOnce({ dismissed: true });
    await putOnboardingFlag({ dismissed: true });
    expect(request).toHaveBeenCalledWith(
      '/storefront/onboarding',
      expect.objectContaining({ method: 'PUT', body: { dismissed: true } }),
    );
  });
});
