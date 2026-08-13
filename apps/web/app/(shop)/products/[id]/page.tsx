'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button, Descriptions, InputNumber, message } from 'antd';
import { ArrowLeftOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import type { ProductResponse } from '@marketplace/contracts';
import { getProduct } from '../../../../lib/api/products';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useCart } from '../../../../lib/cart/cart-context';
import { useResource } from '../../../../lib/use-resource';
import { placeholderFor } from '../../../../lib/placeholder';
import { formatMoney } from '../../../../lib/format';
import { StatusTag } from '../../../../components/status-tag';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';
import { MoreFromShop } from '../../../../components/more-from-shop';

const LOW_STOCK = 5;

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Product');
  const { add } = useCart();
  const [qty, setQty] = useState(1);

  const {
    data: product,
    error,
    loading,
    retry,
  } = useResource<ProductResponse>(() => getProduct(id), [id]);

  // A missing product and a broken engine are different facts and the reader
  // needs to be told which one happened. This previously rendered a skeleton
  // for ever on any failure, which said neither.
  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!product) return null;

  const image = product.images[0];
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
        <div className="mp-detail-media">
          {image ? (
            <img src={image} alt={product.name} />
          ) : (
            <span className="mp-detail-placeholder" style={{ background: gradient }}>
              {initials}
            </span>
          )}
        </div>

        <div className="mp-detail-buy">
          <span className="mp-card-cat">{product.category}</span>
          <h1>{product.name}</h1>

          <div className="mp-detail-price">
            {formatMoney(product.priceMinor)}
            <span className="cur">{product.currency}</span>
          </div>

          <p className="mp-detail-desc">{product.description}</p>

          <div className="mp-detail-avail">
            <StatusTag status={product.status} />
            <span
              className="mp-card-stock"
              data-low={soldOut || product.stock <= LOW_STOCK || undefined}
            >
              {soldOut ? 'Sold out' : `${product.stock} in stock`}
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
                add({
                  productId: product.id,
                  name: product.name,
                  priceMinor: product.priceMinor,
                  qty,
                  image: product.images[0],
                });
                void message.success(`${product.name} added to cart`);
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
