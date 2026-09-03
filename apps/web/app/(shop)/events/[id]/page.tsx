import type { Metadata } from 'next';
import { EventResponseSchema } from '@marketplace/contracts';
import { requestShop } from '../../../../lib/server/shop';
import { shopIdentity } from '../../../../lib/server/shop-identity';
import { publicRead } from '../../../../lib/server/engine';
import { eventMetadata, eventJsonLd } from '../../../../lib/seo/storefront-seo';
import EventDetail from './event-detail';

type Params = { params: Promise<{ id: string }> };

/**
 * Server wrapper: the title, description, canonical and JSON-LD a crawler
 * reads, fetched through the public shop surface -- the same route a
 * stranger's browser uses, so nothing is described here that a stranger
 * could not see. The page itself is the client component beside this file.
 */
async function load({ params }: Params) {
  const shop = await requestShop();
  if (!shop.tenantId) return null;
  const { id } = await params;
  const record = await publicRead(
    `/shops/${encodeURIComponent(shop.tenantId)}/events/${encodeURIComponent(id)}`,
    EventResponseSchema,
  );
  if (!record) return null;
  return { record, identity: await shopIdentity({ ...shop, tenantId: shop.tenantId }) };
}

export async function generateMetadata(props: Params): Promise<Metadata> {
  const loaded = await load(props);
  return loaded ? eventMetadata(loaded.record, loaded.identity) : {};
}

export default async function Page(props: Params) {
  const loaded = await load(props);
  return (
    <>
      {loaded && (
        <script
          type="application/ld+json"
          // JSON, not HTML: the only `<` that could appear is inside a string
          // value, and it is escaped so a description cannot close the tag.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(eventJsonLd(loaded.record, loaded.identity)).replace(/</g, '\\u003c'),
          }}
        />
      )}
      <EventDetail />
    </>
  );
}
