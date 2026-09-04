'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, Descriptions, InputNumber, message } from 'antd';
import { ArrowLeftOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { ProductResponse } from '@marketplace/contracts';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useAuth } from '../../../../lib/auth/auth-context';
import { useShopReads } from '../../../../lib/shop/reads';
import { useShop } from '../../../../lib/shop/shop-context';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useCart } from '../../../../lib/cart/cart-context';
import { useResource } from '../../../../lib/use-resource';
import { placeholderFor } from '../../../../lib/placeholder';
import { formatPrice } from '../../../../lib/format';
import { StatusTag } from '../../../../components/status-tag';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorPanel } from '../../../../components/error-panel';
import { ProblemError } from '../../../../lib/api/http';
import { DetailSkeleton } from '../../../../components/skeletons';
import { MoreFromShop } from '../../../../components/more-from-shop';
import { ProductGallery } from '../../../../components/product-gallery';

const LOW_STOCK = 5;

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const schema = useSchema('Product');
  const { principal } = useAuth();
  const { add } = useCart();
  const reads = useShopReads();
  const shop = useShop();
  const [qty, setQty] = useState(1);

  const {
    data: product,
    error,
    loading,
    retry,
  } = useResource<ProductResponse>(() => reads.getProduct(id), [id, reads]);

  // A missing product and a broken engine are different facts and the reader
  // needs to be told which one happened. This previously rendered a skeleton
  // for ever on any failure, which said neither.
  if (loading) return <DetailSkeleton />;
  // A product that is not there is not a failure to report to a stranger.
  // ErrorPanel is a cockpit component -- it says "This console and the service
  // disagree", prints a trace id twice, and offers a Try again that will fail
  // for ever -- and a shopper who followed a stale link was being shown it.
  if (error instanceof ProblemError && error.status === 404) {
    return (
      <EmptyState
        title="That product is gone"
        description="It may have sold out and been taken down, or the link may be old."
        action={
          <Link href="/products">
            <Button type="primary">See what is in the shop</Button>
          </Link>
        }
      />
    );
  }
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!product) return null;

  const { gradient, initials } = placeholderFor(product.id, product.name);
  const soldOut = product.stock === 0;
  const attributeRows = schema ? toDescriptionRows(schema.fields, product.attributes) : [];

  return (
    <>
      <Link href="/products" className="mp-back">
        <ArrowLeftOutlined /> All products
      </Link>

      {/* Two columns: the photograph carries the page, the buy box holds every
          decision. Previously this was a 160px thumbnail above a flat list in
          which the price had the same weight as `assemblyRequired`. */}
      <div className="mp-detail">
        <ProductGallery images={product.images} alt={product.name}>
          <span className="mp-detail-placeholder" style={{ background: gradient }}>
            {initials}
          </span>
        </ProductGallery>

        <div className="mp-detail-buy">
          <span className="mp-card-cat">{product.category}</span>
          <h1>{product.name}</h1>

          <div className="mp-detail-price">
            {formatPrice(product.priceMinor, product.currency)}
          </div>

          <p className="mp-detail-desc">{product.description}</p>

          <div className="mp-detail-avail">
            {/* No StatusTag. "active" is the seller's word for a listing, and
                it was being shown to shoppers beside the price, where it reads
                as a claim about the object. Availability is the next line, and
                it is the only part of this a customer needs. */}
            <span
              className="mp-card-stock"
              data-low={soldOut || product.stock <= LOW_STOCK || undefined}
            >
              {soldOut
                ? 'Sold out'
                : product.stock <= LOW_STOCK
                  ? `Only ${product.stock} left`
                  : 'In stock'}
            </span>
          </div>

          <div className="mp-detail-actions">
            <InputNumber
              min={1}
              max={Math.max(product.stock, 1)}
              value={qty}
              disabled={soldOut}
              onChange={(v) => setQty(v ?? 1)}
              aria-label="Quantity"
            />
            <Button
              type="primary"
              size="large"
              icon={<ShoppingCartOutlined />}
              disabled={soldOut}
              onClick={() => {
                // On the platform host a stranger is sent to sign in and
                // brought straight back: the token is what names the tenant
                // there. On a shop host the shop is in the address, and a
                // stranger's cart is a ticket away (lib/shop/commerce).
                if (!principal && !shop) {
                  router.push(`/login?next=${encodeURIComponent(`/products/${product.id}`)}`);
                  return;
                }
                // The server resolves name, price and image; the page sends
                // only identity and quantity.
                void add(product.id, qty).then(() =>
                  message.success(`${product.name} added to cart`),
                );
              }}
            >
              Add to cart
            </Button>
          </div>

          {/* Tenant-defined attributes, kept apart from the core facts above --
              they are the tenant's vocabulary, not the platform's. */}
          {attributeRows.length > 0 && (
            <div className="mp-detail-specs">
              <h2>Specifications</h2>
              <Descriptions column={1} size="small" items={attributeRows} />
            </div>
          )}
        </div>
      </div>

      <MoreFromShop excludeId={product.id} />
    </>
  );
}
