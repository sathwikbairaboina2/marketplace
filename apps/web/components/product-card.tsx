'use client';

import Link from 'next/link';
import type { ProductResponse } from '@marketplace/contracts';
import { placeholderFor } from '../lib/placeholder';
import { StatusTag } from './status-tag';
import { formatPrice } from '../lib/format';

const LOW_STOCK = 5;

export function ProductCard({ product }: { product: ProductResponse }) {
  const image = product.images[0];
  const { gradient, initials } = placeholderFor(product.id, product.name);
  const href = `/products/${product.id}`;
  const soldOut = product.stock === 0;

  return (
    <article className="mp-card" data-soldout={soldOut || undefined}>
      <Link href={href} className="mp-card-media" tabIndex={-1} aria-hidden="true">
        {image ? (
          // Plain img, not next/image: the optimiser needs a remotePatterns
          // allow-list that fails confusingly for user-supplied hosts.
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span className="mp-card-placeholder" style={{ background: gradient }}>
            {initials}
          </span>
        )}
        {product.status !== 'active' && (
          <span className="mp-card-badge">
            <StatusTag status={product.status} />
          </span>
        )}
      </Link>

      <div className="mp-card-body">
        <span className="mp-card-cat">{product.category}</span>

        {/* Plain visible text inside the link: catalogue.spec and
            isolation.spec both assert getByText(name). */}
        <Link href={href} className="mp-card-name">
          {product.name}
        </Link>

        <div className="mp-card-foot">
          <span className="mp-card-price">
            {formatPrice(product.priceMinor, product.currency)}
          </span>
          {/* The count is the seller's, not the shopper's: "38 in stock" on
              every card published the inventory of the whole shop. A shopper
              needs to know whether to hurry, and only then how much. */}
          <span className="mp-card-stock" data-low={soldOut || product.stock <= LOW_STOCK}>
            {soldOut
              ? 'Sold out'
              : product.stock <= LOW_STOCK
                ? `Only ${product.stock} left`
                : 'In stock'}
          </span>
        </div>
      </div>
    </article>
  );
}
