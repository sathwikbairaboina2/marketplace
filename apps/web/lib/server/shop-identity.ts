import { StorefrontPublicResponseSchema } from '@marketplace/contracts';
import type { ShopIdentity } from '../seo/storefront-seo';
import { publicRead } from './engine';
import type { RequestShop } from './shop';

/**
 * The shop as a crawler should name it. The published About title is the
 * name the owner chose; before one is published the tenant id stands in, as
 * the storefront hero already shows it.
 */
export async function shopIdentity(shop: RequestShop & { tenantId: string }): Promise<ShopIdentity> {
  const published = await publicRead(
    `/shops/${encodeURIComponent(shop.tenantId)}/storefront`,
    StorefrontPublicResponseSchema,
  );
  return {
    tenantId: shop.tenantId,
    name: published?.config?.about.title ?? shop.tenantId,
    origin: shop.origin,
  };
}
