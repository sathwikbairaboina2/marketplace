'use client';

import Link from 'next/link';
import { Button } from 'antd';
import { EmptyState } from '../../components/empty-state';

/**
 * A path on a shop host that is nobody's page -- a mistyped link, or a
 * product URL from a shop that has since withdrawn it. The shop's chrome
 * stays around it, and the way onward is the catalogue rather than a bare
 * 404 on the platform's own error page.
 */
export default function NotFound() {
  return (
    <EmptyState
      title="There is nothing at this address"
      description="The link may be out of date, or the page may have moved. The shop itself is still here."
      action={
        <Link href="/products">
          <Button type="primary">Browse the shop</Button>
        </Link>
      }
    />
  );
}
