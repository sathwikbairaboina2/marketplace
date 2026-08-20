'use client';

import { createContext, useContext } from 'react';
import type { StorefrontConfig } from '@marketplace/contracts';

/**
 * The published storefront config, fetched once by the shop shell and shared
 * with every storefront surface that renders from it -- the hero banner, the
 * about page, the header's About link. One fetch, one truth; a page that
 * fetched its own copy could disagree with the shell that themed it.
 */
const StorefrontConfigContext = createContext<StorefrontConfig | null>(null);

export function StorefrontConfigProvider({
  config,
  children,
}: {
  config: StorefrontConfig | null;
  children: React.ReactNode;
}) {
  return (
    <StorefrontConfigContext.Provider value={config}>{children}</StorefrontConfigContext.Provider>
  );
}

/** Null means the tenant has never published a storefront -- default chrome. */
export function useStorefrontConfig(): StorefrontConfig | null {
  return useContext(StorefrontConfigContext);
}
