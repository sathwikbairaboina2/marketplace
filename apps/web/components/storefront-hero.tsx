'use client';

import { ShopOutlined } from '@ant-design/icons';
import type { ProductResponse } from '@marketplace/contracts';

/**
 * Filled entirely from data the page already has -- no extra request, and no
 * invented marketing copy, so it reads truthfully for a tenant seeded five
 * minutes ago as well as for one with a real catalogue.
 *
 * The figures describe what has been loaded rather than what exists, because
 * cursor pagination gives no total. Presented as labelled stats rather than a
 * sentence: three numbers in a row are read at a glance, a sentence is not.
 *
 * There is no image. This carried the newest product's generated monogram at
 * hero scale, which on a seeded tenant reads as a photograph that failed to
 * load rather than as art direction -- and it competed with the grid of real
 * cards directly beneath it.
 */
export function StorefrontHero({
  tenantId,
  products,
}: {
  tenantId: string;
  products: ProductResponse[];
}) {
  const categories = new Set(products.map((p) => p.category)).size;
  const inStock = products.filter((p) => p.stock > 0).length;

  return (
    <section className="mp-hero">
      <div className="mp-hero-text">
        <span className="mp-hero-eyebrow">
          <ShopOutlined /> Storefront
        </span>
        <h1>{tenantId}</h1>

        {/* No product name here: the grid below already renders every name,
            and repeating one makes "is this product on the page?" ambiguous --
            it would also keep showing a product the active filter excluded. */}
        <div className="mp-hero-stats">
          <div className="mp-hero-stat">
            <span className="v">{products.length}</span>
            <span className="k">Showing</span>
          </div>
          <div className="mp-hero-stat">
            <span className="v">{categories}</span>
            <span className="k">{categories === 1 ? 'Category' : 'Categories'}</span>
          </div>
          <div className="mp-hero-stat">
            <span className="v">{inStock}</span>
            <span className="k">In stock</span>
          </div>
        </div>
      </div>
    </section>
  );
}
