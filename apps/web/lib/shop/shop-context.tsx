'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { PLATFORM_HOST } from '../env';
import { shopFromHost } from './shop-host';

export interface Shop {
  /** The tenant this hostname names. Reads on this host go through /shops/:tenantId. */
  tenantId: string;
}

type ShopState = { ready: false } | { ready: true; shop: Shop | null };

// No provider means no shop host: a tree rendered without ShopProvider -- a
// unit test, mostly -- behaves as the platform console always has.
const ShopContext = createContext<ShopState>({ ready: true, shop: null });

/**
 * Resolved from `window.location.host` after mount -- the host is a browser
 * fact, and reading it during render would differ between server and client.
 * Until then the shop is unknown and the shop shell renders nothing, exactly
 * as it already waits for the session.
 */
export function ShopProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ShopState>({ ready: false });
  useEffect(() => {
    const tenantId = shopFromHost(window.location.host, PLATFORM_HOST);
    setState({ ready: true, shop: tenantId ? { tenantId } : null });
  }, []);
  return <ShopContext.Provider value={state}>{children}</ShopContext.Provider>;
}

/** `undefined` before the host is known; `null` on the bare platform host. */
export function useShop(): Shop | null | undefined {
  const state = useContext(ShopContext);
  return state.ready ? state.shop : undefined;
}
