import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { StorefrontConfig } from '@marketplace/contracts';
import { StorefrontConfigProvider } from '../../../lib/storefront-config';
import AboutPage from './page';

const config: StorefrontConfig = {
  presetId: 'artisan',
  overrides: {},
  about: {
    title: 'About Kiln & Loom',
    sections: [
      { heading: 'Our studio', body: 'Small-batch ceramics.' },
      { heading: 'Why handmade', body: 'Every piece is signed.' },
    ],
  },
  banners: [],
  businessProfile: { kind: 'ceramics', name: 'Kiln & Loom', tone: 'warm', audience: 'gifts' },
};

describe('the about page', () => {
  it('renders the published story', () => {
    render(
      <StorefrontConfigProvider config={config}>
        <AboutPage />
      </StorefrontConfigProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'About Kiln & Loom' })).toBeInTheDocument();
    expect(screen.getByText('Every piece is signed.')).toBeInTheDocument();
  });

  it('shows a quiet empty state when nothing is published', () => {
    render(
      <StorefrontConfigProvider config={null}>
        <AboutPage />
      </StorefrontConfigProvider>,
    );
    expect(screen.getByText(/hasn't written its story yet/)).toBeInTheDocument();
  });
});
