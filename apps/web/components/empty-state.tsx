'use client';

import { InboxOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/**
 * An empty collection is the first thing a brand-new tenant sees. Left as
 * ANTD's bare "No data" it reads as a failure; naming what is missing and
 * offering the action that fixes it turns it into a starting point.
 *
 * Hand-rolled rather than ANTD's <Empty>, whose default illustration is a grey
 * clipart box that undercuts everything else on the page.
 *
 * `description` and `action` are required, not optional. They were optional,
 * and the result was `/orders` rendering a slab that said "Nothing here yet"
 * and nothing else -- no reason, no way onward. Making the type demand them is
 * what stops that recurring the next time someone adds a list.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mp-empty">
      <span className="mp-empty-icon" aria-hidden="true">
        {icon ?? <InboxOutlined />}
      </span>
      <p className="mp-empty-title">{title}</p>
      <p className="mp-empty-desc">{description}</p>
      <div className="mp-empty-action">{action}</div>
    </div>
  );
}
