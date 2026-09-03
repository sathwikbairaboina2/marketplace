import type { Metadata, MetadataRoute } from 'next';
import type { EventResponse, ProductResponse } from '@marketplace/contracts';
import { formatMoney } from '../format';

/** What a crawler is told about a shop. Everything here is derived from published data. */
export interface ShopIdentity {
  tenantId: string;
  /** The published About title, or the tenant id until the owner writes one. */
  name: string;
  origin: string;
}

const clip = (text: string, max = 160): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

export function shopMetadata(shop: ShopIdentity): Metadata {
  return {
    metadataBase: new URL(shop.origin),
    title: { default: shop.name, template: `%s · ${shop.name}` },
    alternates: { canonical: '/products' },
    openGraph: { siteName: shop.name, type: 'website', url: '/products' },
  };
}

export function productMetadata(product: ProductResponse, shop: ShopIdentity): Metadata {
  const path = `/products/${product.id}`;
  const description = clip(product.description);
  return {
    title: product.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: product.name,
      description,
      type: 'website',
      url: path,
      siteName: shop.name,
      images: product.images.length ? product.images : undefined,
    },
  };
}

export function eventMetadata(event: EventResponse, shop: ShopIdentity): Metadata {
  const path = `/events/${event.id}`;
  return {
    title: event.title,
    alternates: { canonical: path },
    openGraph: { title: event.title, type: 'website', url: path, siteName: shop.name },
  };
}

/** schema.org Product with one Offer: what a search result card is built from. */
export function productJsonLd(product: ProductResponse, shop: ShopIdentity): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.images,
    category: product.category,
    url: `${shop.origin}/products/${product.id}`,
    offers: {
      '@type': 'Offer',
      // Minor units in the engine, a decimal string here: schema.org wants
      // "74.00", and the formatter is the one place that division lives.
      price: formatMoney(product.priceMinor, product.currency),
      priceCurrency: product.currency,
      availability:
        product.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `${shop.origin}/products/${product.id}`,
      seller: { '@type': 'Organization', name: shop.name },
    },
  };
}

export function eventJsonLd(event: EventResponse, shop: ShopIdentity): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    url: `${shop.origin}/events/${event.id}`,
    organizer: { '@type': 'Organization', name: shop.name },
    offers: {
      '@type': 'Offer',
      price: formatMoney(event.basePriceMinor, event.currency),
      priceCurrency: event.currency,
      availability:
        event.bookedCount < event.capacity ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
      url: `${shop.origin}/events/${event.id}`,
    },
  };
}

/**
 * The shop's pages, and only the shop's: nothing under /cart, /orders or
 * /bookings is anybody's to index. The platform host has no sitemap at all.
 */
export function shopSitemap(
  shop: ShopIdentity,
  products: ProductResponse[],
  events: EventResponse[],
): MetadataRoute.Sitemap {
  const at = (path: string, lastModified?: string) => ({
    url: `${shop.origin}${path}`,
    ...(lastModified ? { lastModified } : {}),
  });
  return [
    at('/products'),
    at('/events'),
    at('/about'),
    ...products.map((p) => at(`/products/${p.id}`, p.updatedAt)),
    // Events carry no updatedAt; the day they were listed is the best date there is.
    ...events.map((e) => at(`/events/${e.id}`, e.createdAt)),
  ];
}

/** A shop is open to crawlers except for the pages that are somebody's; the console is closed. */
export function shopRobots(shop: RequestShopLike): MetadataRoute.Robots {
  if (!shop.tenantId) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/cart', '/orders', '/bookings', '/login', '/admin'] },
    sitemap: `${shop.origin}/sitemap.xml`,
  };
}

interface RequestShopLike {
  tenantId: string | null;
  origin: string;
}
