import { describe, expect, it } from 'vitest';
import {
  eventJsonLd,
  productJsonLd,
  productMetadata,
  shopMetadata,
  shopRobots,
  shopSitemap,
} from './storefront-seo';

const shop = { tenantId: 'acme', name: 'Acme Homeware', origin: 'http://acme.localhost:33002' };

const product = {
  entityType: 'Product' as const,
  pinned: false,
  id: '01KZERNS77Z1E2HB509WV80MN6',
  name: 'Steel Pour-Over Kettle',
  description: 'Stainless gooseneck kettle, stovetop safe, 1.2L.',
  category: 'coffee',
  priceMinor: 7400,
  currency: 'USD' as const,
  stock: 11,
  status: 'active' as const,
  images: ['http://localhost:34566/marketplace-media/acme/products/x/kettle.jpg'],
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-09-01T12:00:00.000Z',
  attributes: {},
};

const event = {
  entityType: 'Event' as const,
  id: '01KZERNS77Z1E2HB509WV80MN7',
  images: [],
  title: 'Glaze & Fire Workshop',
  capacity: 24,
  bookedCount: 2,
  startDate: '2026-09-12T10:00:00.000Z',
  endDate: '2026-09-12T16:00:00.000Z',
  basePriceMinor: 6500,
  currency: 'USD' as const,
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-16T12:00:00.000Z',
  attributes: {},
};

describe('storefront SEO', () => {
  it('titles the shop and templates every page under it', () => {
    const meta = shopMetadata(shop);
    expect(meta.title).toEqual({ default: 'Acme Homeware', template: '%s · Acme Homeware' });
    expect(meta.metadataBase?.toString()).toBe('http://acme.localhost:33002/');
  });

  it('gives a product a title, a clipped description, a canonical and its image', () => {
    const meta = productMetadata(product, shop);
    expect(meta.title).toBe('Steel Pour-Over Kettle');
    expect(meta.description).toBe('Stainless gooseneck kettle, stovetop safe, 1.2L.');
    expect(meta.alternates?.canonical).toBe('/products/01KZERNS77Z1E2HB509WV80MN6');
    expect((meta.openGraph as { images?: string[] }).images).toEqual(product.images);
  });

  it('clips a long description at 160 characters with an ellipsis', () => {
    const long = { ...product, description: 'x'.repeat(300) };
    expect(productMetadata(long, shop).description).toHaveLength(160);
    expect(productMetadata(long, shop).description?.endsWith('…')).toBe(true);
  });

  it('describes a product to schema.org in decimal money, with stock as availability', () => {
    const ld = productJsonLd(product, shop);
    expect(ld).toMatchObject({
      '@type': 'Product',
      name: 'Steel Pour-Over Kettle',
      offers: { price: '74.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    });
    expect(productJsonLd({ ...product, stock: 0 }, shop)).toMatchObject({
      offers: { availability: 'https://schema.org/OutOfStock' },
    });
  });

  it('describes an event with its dates and whether places remain', () => {
    expect(eventJsonLd(event, shop)).toMatchObject({
      '@type': 'Event',
      startDate: '2026-09-12T10:00:00.000Z',
      offers: { price: '65.00', availability: 'https://schema.org/InStock' },
    });
    expect(eventJsonLd({ ...event, bookedCount: 24 }, shop)).toMatchObject({
      offers: { availability: 'https://schema.org/SoldOut' },
    });
  });

  it('lists the shop pages and every product and event, nothing personal', () => {
    const urls = shopSitemap(shop, [product], [event]).map((e) => e.url);
    expect(urls).toEqual([
      'http://acme.localhost:33002/products',
      'http://acme.localhost:33002/events',
      'http://acme.localhost:33002/about',
      'http://acme.localhost:33002/products/01KZERNS77Z1E2HB509WV80MN6',
      'http://acme.localhost:33002/events/01KZERNS77Z1E2HB509WV80MN7',
    ]);
    expect(urls.some((u) => /cart|orders|bookings/.test(u))).toBe(false);
  });

  it('opens a shop to crawlers except the pages that are somebody\'s, and closes the console', () => {
    const open = shopRobots({ tenantId: 'acme', origin: shop.origin });
    expect(open.rules).toMatchObject({ allow: '/', disallow: ['/cart', '/orders', '/bookings', '/login', '/admin'] });
    expect(open.sitemap).toBe('http://acme.localhost:33002/sitemap.xml');
    expect(shopRobots({ tenantId: null, origin: 'http://localhost:33002' }).rules).toEqual({
      userAgent: '*',
      disallow: '/',
    });
  });
});
