'use client';

import Link from 'next/link';
import { Button } from 'antd';
import { AboutSections } from '../../../components/about-sections';
import { EmptyState } from '../../../components/empty-state';
import { useStorefrontConfig } from '../../../lib/storefront-config';

export default function AboutPage() {
  const config = useStorefrontConfig();

  if (!config) {
    return (
      <EmptyState
        title="This shop hasn't written its story yet"
        description="Check back soon — the owner is still setting things up."
        action={
          <Link href="/products">
            <Button type="primary">Browse products</Button>
          </Link>
        }
      />
    );
  }

  return <AboutSections about={config.about} />;
}
