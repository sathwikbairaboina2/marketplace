'use client';

import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="mp-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {extra && <div className="mp-page-header-extra">{extra}</div>}
    </div>
  );
}
