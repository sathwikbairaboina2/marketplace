'use client';

import type { ProductResponse } from '@marketplace/contracts';
import { placeholderFor } from '../lib/placeholder';

/**
 * Filled entirely from data the page already has -- no extra request, and no
 * invented marketing copy, so it reads truthfully for a tenant seeded five
 * minutes ago as well as for one with a real catalogue.
 *
 * The counts describe what has been loaded rather than what exists, because
 * cursor pagination gives no total. The wording says so.
 */
export function StorefrontHero({
  tenantId,
  products,
}: {
  tenantId: string;
  products: ProductResponse[];
}) {
  const categories = new Set(products.map((p) => p.category)).size;
  const newest = [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const shot = newest ? placeholderFor(newest.id, newest.name) : null;

  return (
    <section className="mp-hero">
      <div className="mp-hero-text">
        <h1>{tenantId}</h1>
        {/* Counts only -- deliberately no product name. Naming the newest
            product here would repeat text the grid already renders, which makes
            "is this product on the page?" ambiguous for a reader and for a
            test, and would keep showing a product that the active filter has
            excluded from the results below. */}
        <p>
          {products.length === 0
            ? 'No products in this catalogue yet'
            : `Showing ${products.length} product${products.length === 1 ? '' : 's'} across ${categories} categor${categories === 1 ? 'y' : 'ies'}`}
        </p>
      </div>

      {newest && (
        <div className="mp-hero-shot">
          {newest.images[0] ? (
            <img src={newest.images[0]} alt="" loading="lazy" />
          ) : (
            <span style={{ background: shot!.gradient }}>{shot!.initials}</span>
          )}
        </div>
      )}
    </section>
  );
}
