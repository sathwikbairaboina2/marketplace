import type { Metadata } from 'next';
import { requestShop } from '../../lib/server/shop';
import { shopIdentity } from '../../lib/server/shop-identity';
import { shopMetadata } from '../../lib/seo/storefront-seo';
import ShopShell from './shop-shell';

/**
 * The server half of the shop: what the document says about itself before
 * any script runs. The shell that renders the page is a client component
 * (shop-shell.tsx) and unchanged; this layout exists so a crawler on
 * `acme.localhost` reads the shop's own name in the title rather than
 * "Marketplace".
 */
export async function generateMetadata(): Promise<Metadata> {
  const shop = await requestShop();
  if (!shop.tenantId) return {};
  return shopMetadata(await shopIdentity({ ...shop, tenantId: shop.tenantId }));
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return <ShopShell>{children}</ShopShell>;
}
