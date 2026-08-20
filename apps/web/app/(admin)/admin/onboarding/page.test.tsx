import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import type { OnboardingSnapshot, StorefrontConfig } from '@marketplace/contracts';

const socket = {
  snapshot: null as OnboardingSnapshot | null,
  connected: true,
  error: null as string | null,
  send: vi.fn(),
};
vi.mock('../../../../lib/chat/use-onboarding-socket', () => ({
  useOnboardingSocket: () => socket,
}));

const getStorefrontDraft = vi.fn();
const publishStorefront = vi.fn();
const putOnboardingFlag = vi.fn();
vi.mock('../../../../lib/api/storefront', () => ({
  getStorefrontDraft: () => getStorefrontDraft(),
  publishStorefront: () => publishStorefront(),
  putOnboardingFlag: (body: unknown) => putOnboardingFlag(body),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));
vi.mock('../../../../lib/theme/theme-context', () => ({ useTheme: () => ({ mode: 'light' }) }));

import OnboardingPage from './page';

const config: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: { title: 'About Kiln & Loom', sections: [{ heading: 'h', body: 'b' }] },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 's',
      cta: { label: 'Browse', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: { kind: 'k', name: 'n', tone: 't', audience: 'a' },
};

const draftedSnapshot: OnboardingSnapshot = {
  threadId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  kind: 'onboarding',
  phase: 'drafted',
  messages: [
    { role: 'user', content: 'I make pottery' },
    { role: 'assistant', content: 'Draft updated.' },
  ],
  draft: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  socket.snapshot = null;
});

describe('the onboarding wizard', () => {
  it('starts with an empty preview and a disabled publish', () => {
    render(<OnboardingPage />);
    expect(screen.getByTestId('preview-empty')).toBeInTheDocument();
    expect(screen.getByTestId('publish-store')).toBeDisabled();
  });

  it('refetches the engine draft when a drafted snapshot arrives and enables publish', async () => {
    socket.snapshot = draftedSnapshot;
    getStorefrontDraft.mockResolvedValue({ draft: config, capabilities: { imageGen: false } });

    render(<OnboardingPage />);
    await act(async () => {});

    expect(getStorefrontDraft).toHaveBeenCalled();
    expect(screen.getByTestId('preview')).toBeInTheDocument();
    expect(screen.getByText('Objects with a thumbprint')).toBeInTheDocument();
    expect(screen.getByTestId('publish-store')).toBeEnabled();
  });

  it('dismisses onboarding through the flag and leaves for the cockpit', async () => {
    putOnboardingFlag.mockResolvedValue({ dismissed: true });

    render(<OnboardingPage />);
    fireEvent.click(screen.getByTestId('skip-onboarding'));

    await waitFor(() => expect(putOnboardingFlag).toHaveBeenCalledWith({ dismissed: true }));
    expect(push).toHaveBeenCalledWith('/admin/products');
  });
});
