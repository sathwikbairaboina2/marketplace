'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, Card, Descriptions, InputNumber, Space, Spin, message } from 'antd';
import type { ProductResponse } from '@marketplace/contracts';
import { getProduct } from '../../../../lib/api/products';
import { toDescriptionRows } from '../../../../lib/schema-fields';
import { useSchema } from '../../../../lib/schemas/schema-cache';
import { useCart } from '../../../../lib/cart/cart-context';
import { notifyProblem } from '../../../../lib/problem-notify';
import { StatusTag } from '../../../../components/status-tag';

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const schema = useSchema('Product');
  const { add } = useCart();
  const [product, setProduct] = useState<ProductResponse | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    getProduct(id).then(setProduct).catch(notifyProblem);
  }, [id]);

  if (!product) return <Spin />;

  return (
    <Card title={product.name}>
      {product.images.length > 0 && (
        <Space wrap style={{ marginBottom: 16 }}>
          {product.images.map((url) => (
            <img
              key={url}
              src={url}
              alt={product.name}
              width={160}
              height={160}
              style={{ objectFit: 'cover', borderRadius: 8 }}
            />
          ))}
        </Space>
      )}
      <Descriptions
        column={1}
        items={[
          { key: 'description', label: 'Description', children: product.description },
          { key: 'category', label: 'Category', children: product.category },
          {
            key: 'price',
            label: 'Price',
            children: `${(product.priceMinor / 100).toFixed(2)} ${product.currency}`,
          },
          { key: 'stock', label: 'Stock', children: product.stock },
          { key: 'status', label: 'Status', children: <StatusTag status={product.status} /> },
          // Every tenant-defined attribute, rendered without naming any of them.
          ...(schema ? toDescriptionRows(schema.fields, product.attributes) : []),
        ]}
      />
      <Space style={{ marginTop: 16 }}>
        <InputNumber min={1} max={product.stock} value={qty} onChange={(v) => setQty(v ?? 1)} />
        <Button
          type="primary"
          disabled={product.stock < 1}
          onClick={() => {
            add({
              productId: product.id,
              name: product.name,
              priceMinor: product.priceMinor,
              qty,
            });
            void message.success(`${product.name} added to cart`);
          }}
        >
          Add to cart
        </Button>
      </Space>
    </Card>
  );
}
