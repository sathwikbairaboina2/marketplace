'use client';

import Link from 'next/link';
import type { ProductResponse } from '@marketplace/contracts';
import { placeholderFor } from '../lib/placeholder';
import { StatusTag } from './status-tag';

export function ProductCard({ product }: { product: ProductResponse }) {
  const image = product.images[0];
  const { gradient, initials } = placeholderFor(product.id, product.name);

  return (
    <article className="mp-card">
      <Link href={`/products/${product.id}`} className="mp-card-media" aria-hidden="true">
        {image ? (
          // Plain img, not next/image: the optimiser needs a remotePatterns
          // allow-list that fails confusingly for user-supplied hosts.
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span className="mp-card-placeholder" style={{ background: gradient }}>
            {initials}
          </span>
        )}
      </Link>

      <div className="mp-card-body">
        {/* The product name stays plain visible text inside the link:
            catalogue.spec and isolation.spec both assert getByText(name). */}
        <Link href={`/products/${product.id}`} className="mp-card-name">
          {product.name}
        </Link>
        <div className="mp-card-meta">
          <span className="mp-card-price">
            {(product.priceMinor / 100).toFixed(2)} {product.currency}
          </span>
          {product.status !== 'active' && <StatusTag status={product.status} />}
        </div>
        <div className="mp-card-sub">{product.category}</div>
      </div>
    </article>
  );
}
