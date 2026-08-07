'use client';

import { Empty } from 'antd';
import type { ReactNode } from 'react';

/**
 * An empty table is the first thing a brand-new tenant sees. Left as ANTD's
 * bare "No data" it reads as a failure; saying what is missing and offering the
 * action that fixes it turns it into a starting point.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <span>
          <strong style={{ color: 'var(--mp-ink)' }}>{title}</strong>
          {description && (
            <span style={{ display: 'block', color: 'var(--mp-muted)', marginTop: 4 }}>
              {description}
            </span>
          )}
        </span>
      }
    >
      {action}
    </Empty>
  );
}
