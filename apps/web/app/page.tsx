import { redirect } from 'next/navigation';
import { requestShop } from '../lib/server/shop';
import ShopHome from './(shop)/home/home-page';

/**
 * The front door.
 *
 * On a shop host this is the shop's own home page: a stranger arriving from an
 * Instagram link used to land on a search-results page with a filter rail down
 * its left side, because this file was four lines of `redirect('/products')`.
 *
 * On the platform host there is no shop to be a front door *for* -- the token
 * is what names the tenant there -- so the redirect stands.
 */
export default async function Home() {
  const shop = await requestShop();
  if (!shop.tenantId) redirect('/products');
  return <ShopHome />;
}
