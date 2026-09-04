import { redirect } from 'next/navigation';
import { requestShop } from '../../lib/server/shop';
import ShopHome from './home/home-page';

/**
 * The front door.
 *
 * Inside the `(shop)` route group, not at the app root, so it gets the shell
 * every other storefront page has -- announcement bar, masthead, navigation
 * and footer. At the root it rendered as a bare page with no way to reach the
 * rest of the shop, which is worse than the redirect it replaced.
 *
 * On the platform host there is no shop to be a front door *for* -- the token
 * is what names the tenant there -- so the redirect stands.
 */
export default async function Home() {
  const shop = await requestShop();
  if (!shop.tenantId) redirect('/products');
  return <ShopHome />;
}
