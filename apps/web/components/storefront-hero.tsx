'use client';

/**
 * The band above the grid when the owner has not published a hero banner:
 * the shop's name and what it is. Nothing else.
 *
 * This used to carry three live counters -- Showing, Categories, In stock --
 * computed from whatever page of products had loaded. They were the shop's
 * inventory report where a shopper expected the shop, and they published the
 * stock position of the whole catalogue to anyone who opened it. A published
 * banner replaces this band entirely (see products/page.tsx).
 */
export function StorefrontHero({ name, tagline }: { name: string; tagline?: string }) {
  return (
    <section className="mp-hero">
      <div className="mp-hero-text">
        <h1>{name}</h1>
        {tagline && <p className="mp-hero-tagline">{tagline}</p>}
      </div>
    </section>
  );
}
