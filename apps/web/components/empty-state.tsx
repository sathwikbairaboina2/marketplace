'use client';

import { InboxOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/**
 * An empty table is the first thing a brand-new tenant sees. Left as ANTD's
 * bare "No data" it reads as a failure; naming what is missing and offering
 * the action that fixes it turns it into a starting point.
 *
 * Hand-rolled rather than ANTD's <Empty>, whose default illustration is a grey
 * clipart box that undercuts everything else on the page.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mp-empty" style={{ textAlign: 'center' }}>
      <div aria-hidden="true">{icon ?? <InboxOutlined />}</div>
      <div style={{ fontWeight: 600, color: 'var(--mp-ink)', fontSize: 'var(--mp-text-md)' }}>
        {title}
      </div>
      {description && (
        <div
          style={{
            color: 'var(--mp-muted)',
            marginTop: 6,
            maxWidth: '46ch',
            marginInline: 'auto',
          }}
        >
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 'var(--mp-space-5)' }}>{action}</div>}
    </div>
  );
}
