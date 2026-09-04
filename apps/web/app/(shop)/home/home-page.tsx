'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import type { EventResponse, ProductResponse } from '@marketplace/contracts';
import { useShop } from '../../../lib/shop/shop-context';
import { useShopReads } from '../../../lib/shop/reads';
import { shopDisplayName, useStorefrontConfig } from '../../../lib/storefront-config';
import { ProductCard } from '../../../components/product-card';
import { EventCard } from '../../../components/event-card';
import { StorefrontBanner } from '../../../components/storefront-banner';
import { StorefrontHero } from '../../../components/storefront-hero';

/** How many pieces the front door shows before sending people to the shop. */
const SHELF = 6;
const CLASSES = 3;

/**
 * The shop's front door.
 *
 * `/` was four lines of `redirect('/products')`, so the first thing a stranger
 * saw was a search-results page with a filter rail down its left side. This is
 * not a landing page in the marketing sense — the merchant supplies nothing
 * new for it. Every band is drawn from what she has already published, and a
 * band with nothing behind it does not render, because most shops here have
 * three products and one photograph and an empty state is worse than a
 * shorter page.
 */
export default function ShopHome() {
  const shop = useShop();
  const reads = useShopReads();
  const storefront = useStorefrontConfig();
  const [products, setProducts] = useState<ProductResponse[]>([]);
  const [events, setEvents] = useState<EventResponse[]>([]);

  useEffect(() => {
    let live = true;
    void reads
      .listProducts(SHELF, null)
      .then((page) => {
        if (live) setProducts(page.items);
      })
      .catch(() => {
        // A front door that cannot load its shelf is a shorter front door.
      });
    void reads
      .listEvents(CLASSES, null)
      .then((page) => {
        if (live) setEvents(page.items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [reads]);

  const hero = storefront?.banners.find((b) => b.slot === 'hero');
  const mid = storefront?.banners.find((b) => b.slot === 'mid');
  const about = storefront?.about;
  const name = shopDisplayName(storefront, shop?.tenantId);

  return (
    <>
      {hero ? (
        <StorefrontBanner banner={hero} />
      ) : (
        <StorefrontHero name={name} tagline={storefront?.businessProfile.kind} />
      )}

      {products.length > 0 && (
        <section className="mp-home-band">
          <div className="mp-home-head">
            <h2>In the shop</h2>
            <Link href="/products">See everything</Link>
          </div>
          <div className="mp-grid">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      )}

      {/* The About page is the one screen of this product that sounds like a
          person, and it was three clicks from the front door. */}
      {about && about.sections.length > 0 && (
        <section className="mp-home-band mp-home-story">
          <h2>{about.title}</h2>
          <p>{about.sections[0].body}</p>
          <Link href="/about">
            <Button>More about {name}</Button>
          </Link>
        </section>
      )}

      {mid && <StorefrontBanner banner={mid} />}

      {events.length > 0 && (
        <section className="mp-home-band">
          <div className="mp-home-head">
            <h2>Classes and events</h2>
            <Link href="/events">All of them</Link>
          </div>
          <div className="mp-grid">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
