import type { MetadataRoute } from 'next';
import { EventResponseSchema, ProductResponseSchema, pageOf } from '@marketplace/contracts';
import { requestShop } from '../lib/server/shop';
import { shopIdentity } from '../lib/server/shop-identity';
import { publicRead } from '../lib/server/engine';
import { shopSitemap } from '../lib/seo/storefront-seo';

export const dynamic = 'force-dynamic';

const Products = pageOf(ProductResponseSchema);
const Events = pageOf(EventResponseSchema);

/**
 * One page of each, the engine's maximum. A shop with more than a hundred
 * products needs a sitemap index, which is a later slice; the URLs a crawler
 * gets today are still all real.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const shop = await requestShop();
  if (!shop.tenantId) return [];
  const base = `/shops/${encodeURIComponent(shop.tenantId)}`;
  const [identity, products, events] = await Promise.all([
    shopIdentity({ ...shop, tenantId: shop.tenantId }),
    publicRead(`${base}/products?limit=100`, Products),
    publicRead(`${base}/events?limit=100`, Events),
  ]);
  return shopSitemap(identity, products?.items ?? [], events?.items ?? []);
}
