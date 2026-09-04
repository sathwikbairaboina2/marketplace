'use client';

import { useEffect, useState } from 'react';
import type { ProductResponse } from '@marketplace/contracts';
import { useShopReads } from '../lib/shop/reads';
import { ProductCard } from './product-card';

/**
 * The shop's other work, under a detail page. Fills the dead half of the page
 * with the one thing a browsing customer actually wants next -- and quietly
 * disappears when the shop has nothing else, because an empty suggestion row
 * reads as a failed one.
 */
export function MoreFromShop({ excludeId }: { excludeId: string }) {
  const reads = useShopReads();
  const [items, setItems] = useState<ProductResponse[]>([]);

  useEffect(() => {
    let cancelled = false;
    reads
      .listProducts(8, null)
      .then((page) => {
        if (cancelled) return;
        // Sellable first, and never a sold-out product in a suggestion row:
        // four tiles offering things nobody can buy is worse than three, and
        // the engine's own ordering put the shop's newest listing first
        // whether or not it was in stock.
        const others = page.items.filter((p) => p.id !== excludeId);
        const sellable = others.filter((p) => p.stock > 0);
        setItems((sellable.length > 0 ? sellable : others).slice(0, 4));
      })
      .catch(() => {
        /* a missing suggestion row is silence, not an error */
      });
    return () => {
      cancelled = true;
    };
  }, [excludeId, reads]);

  if (items.length === 0) return null;

  return (
    <section className="mp-more" aria-label="More from this shop">
      <h2>More from this shop</h2>
      <div className="mp-grid mp-more-grid">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
