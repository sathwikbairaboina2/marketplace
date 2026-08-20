import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SetupPlan, StorefrontConfig } from '@marketplace/contracts';

vi.mock('../../../../lib/api/storefront', () => ({ generateBannerArt: vi.fn() }));
vi.mock('../../../../lib/api/uploads', () => ({ uploadProductImage: vi.fn() }));
vi.mock('../../../../lib/api/agents', () => ({ applySetupPlan: vi.fn() }));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));
vi.mock('../../../../lib/theme/theme-context', () => ({ useTheme: () => ({ mode: 'light' }) }));

import { PreviewPane } from './preview-pane';

const draft: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: { title: 'About Kiln & Loom', sections: [{ heading: 'Our studio', body: 'Ceramics.' }] },
  banners: [
    {
      id: 'hero-1',
      slot: 'hero',
      headline: 'Objects with a thumbprint',
      subline: 'Stoneware, signed by the maker.',
      cta: { label: 'Browse', href: '/products' },
      art: { kind: 'css' },
    },
  ],
  businessProfile: { kind: 'ceramics', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
};

const plan: SetupPlan = { sellsWhat: 'bookable', categories: ['classes'], fields: [] };

describe('PreviewPane', () => {
  it('shows the placeholder product grid for a shop that sells goods', () => {
    render(<PreviewPane draft={{ ...draft, sellsWhat: 'goods' }} onChange={() => {}} />);

    expect(screen.getByText('Product One')).toBeInTheDocument();
  });

  it('still shows it for a shop published before sellsWhat existed', () => {
    render(<PreviewPane draft={draft} onChange={() => {}} />);

    expect(screen.getByText('Product One')).toBeInTheDocument();
  });

  it('suppresses the placeholder product grid for a bookable shop', () => {
    render(<PreviewPane draft={{ ...draft, sellsWhat: 'bookable' }} onChange={() => {}} />);

    expect(screen.queryByText('Product One')).not.toBeInTheDocument();
  });

  it('hides the Setup tab until there is a plan', () => {
    render(<PreviewPane draft={draft} onChange={() => {}} />);

    expect(screen.queryByText('Setup')).not.toBeInTheDocument();
  });

  it('offers the Setup tab once a plan arrives', () => {
    render(<PreviewPane draft={draft} setupPlan={plan} onChange={() => {}} />);

    expect(screen.getByText('Setup')).toBeInTheDocument();
  });
});
