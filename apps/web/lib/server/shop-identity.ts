import { StorefrontPublicResponseSchema } from '@marketplace/contracts';
import type { ShopIdentity } from '../seo/storefront-seo';
import { publicRead } from './engine';
import type { RequestShop } from './shop';

/**
 * The shop as a crawler should name it: the business name from the owner's
 * interview, else the About title, else the tenant id. The same chain as
 * `shopDisplayName` in lib/storefront-config.tsx, which the header and the
 * hero use -- the search result and the masthead must agree.
 */
export async function shopIdentity(shop: RequestShop & { tenantId: string }): Promise<ShopIdentity> {
  const published = await publicRead(
    `/shops/${encodeURIComponent(shop.tenantId)}/storefront`,
    StorefrontPublicResponseSchema,
  );
  return {
    tenantId: shop.tenantId,
    name:
      published?.config?.businessProfile.name ?? published?.config?.about.title ?? shop.tenantId,
    origin: shop.origin,
  };
}
