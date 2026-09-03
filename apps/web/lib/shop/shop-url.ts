'use client';

import { useEffect, useState } from 'react';
import { PLATFORM_HOST } from '../env';

/**
 * Where a tenant's shop is, as a link: `<scheme>//acme.<platform host>/products`.
 *
 * The scheme comes from the page, because the platform host carries none
 * (`localhost:33002` in Docker, a bare domain in production) and a shop is
 * served however the console was reached. Resolved after mount: the sidebar
 * is server-rendered too, and `window` is not there yet.
 */
export function useShopUrl(tenantId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!tenantId) {
      setUrl(null);
      return;
    }
    setUrl(`${window.location.protocol}//${tenantId}.${PLATFORM_HOST}/products`);
  }, [tenantId]);
  return url;
}
