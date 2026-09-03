import { headers } from 'next/headers';
import { PLATFORM_HOST } from '../env';
import { shopFromHost } from '../shop/shop-host';

/** What a request is for, read from its own headers: the shop (or none) and the origin to write URLs with. */
export interface RequestShop {
  tenantId: string | null;
  /** Scheme and host a crawler used to reach us, e.g. `http://acme.localhost:33002`. */
  origin: string;
}

/**
 * The server-side twin of ShopProvider. The browser reads `window.location`;
 * a server component reads the Host header, which is the same fact arriving
 * by a different road. Pure over the header values so it can be tested
 * without Next's request scope.
 */
export function requestShopFrom(host: string | null, proto: string | null): RequestShop {
  const h = host ?? PLATFORM_HOST;
  return {
    tenantId: shopFromHost(h, PLATFORM_HOST),
    origin: `${proto === 'https' ? 'https' : 'http'}://${h}`,
  };
}

export async function requestShop(): Promise<RequestShop> {
  const h = await headers();
  return requestShopFrom(h.get('host'), h.get('x-forwarded-proto'));
}
