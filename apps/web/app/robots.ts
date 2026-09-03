import type { MetadataRoute } from 'next';
import { requestShop } from '../lib/server/shop';
import { shopRobots } from '../lib/seo/storefront-seo';

// Per host: a shop is open, the console is closed. See storefront-seo.ts.
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  return shopRobots(await requestShop());
}
