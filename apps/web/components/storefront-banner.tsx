'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { Banner } from '@marketplace/contracts';

/**
 * One tenant banner, drawn entirely from theme variables and the banner's own
 * copy. Shared verbatim between the live storefront and the onboarding
 * wizard's preview -- the preview renders this component, so it cannot drift
 * from what customers see.
 */
export function StorefrontBanner({ banner }: { banner: Banner }) {
  const art = banner.art;
  const hasImage = art.kind !== 'css';
  const style: React.CSSProperties =
    art.kind === 'css'
      ? { background: 'var(--mp-hero-bg)' }
      : {
          // A fixed scrim under white text: photography is uncontrolled input,
          // and the text must survive whatever the owner uploads.
          backgroundImage: `linear-gradient(rgb(0 0 0 / 35%), rgb(0 0 0 / 35%)), url(${art.imageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        };

  return (
    <section
      className="mp-hero mp-banner"
      data-slot={banner.slot}
      style={style}
    >
      <div className="mp-hero-text">
        <h1
          style={{
            fontFamily: 'var(--mp-font-heading)',
            color: hasImage ? '#ffffff' : 'var(--mp-hero-ink)',
          }}
        >
          {banner.headline}
        </h1>
        <p style={{ color: hasImage ? 'rgb(255 255 255 / 88%)' : 'var(--mp-hero-muted)' }}>
          {banner.subline}
        </p>
        <Link href={banner.cta.href}>
          <Button type="primary">{banner.cta.label}</Button>
        </Link>
      </div>
    </section>
  );
}
