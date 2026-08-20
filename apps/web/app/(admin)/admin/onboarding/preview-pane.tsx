'use client';

import { useState } from 'react';
import { Empty, Segmented } from 'antd';
import type { StorefrontConfig } from '@marketplace/contracts';
import { AboutSections } from '../../../../components/about-sections';
import { StorefrontBanner } from '../../../../components/storefront-banner';
import { resolveTheme } from '../../../../lib/theme/resolve';
import { useTheme } from '../../../../lib/theme/theme-context';

type Tab = 'storefront' | 'about' | 'banners';

/**
 * The right half of the wizard. Renders the draft with the same resolveTheme
 * and the same banner/about components the live storefront uses, scoped to
 * this pane -- what the owner sees here is what a customer would see, minus
 * the real catalogue.
 */
export function PreviewPane({ draft }: { draft: StorefrontConfig | null }) {
  const { mode } = useTheme();
  const [tab, setTab] = useState<Tab>('storefront');

  if (!draft) {
    return (
      <div className="mp-onboarding-preview" data-testid="preview-empty">
        <Empty description="Your store preview appears here as we talk" />
      </div>
    );
  }

  const vars = resolveTheme(draft, mode) as React.CSSProperties;
  const hero = draft.banners.find((b) => b.slot === 'hero');

  return (
    <div className="mp-onboarding-preview" data-testid="preview">
      <Segmented
        value={tab}
        onChange={(value) => setTab(value as Tab)}
        options={[
          { label: 'Storefront', value: 'storefront' },
          { label: 'About', value: 'about' },
          { label: 'Banners', value: 'banners' },
        ]}
      />

      <div className="mp-onboarding-canvas" style={vars}>
        {tab === 'storefront' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            {hero && <StorefrontBanner banner={hero} />}
            {/* Placeholder product cards so the card treatment -- radius,
                hairline, raised surface, fonts -- previews alongside the hero. */}
            <div className="mp-onboarding-cards">
              {['One', 'Two', 'Three'].map((name) => (
                <div key={name} className="mp-onboarding-card">
                  <div className="thumb" />
                  <span className="nm" style={{ fontFamily: 'var(--mp-font-heading)' }}>
                    Product {name}
                  </span>
                  <span className="pr">$ —</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'about' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            <AboutSections about={draft.about} />
          </div>
        )}

        {tab === 'banners' && (
          <div style={{ background: 'var(--mp-surface)', padding: 'var(--mp-space-4)' }}>
            {draft.banners.map((banner) => (
              <StorefrontBanner key={banner.id} banner={banner} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
