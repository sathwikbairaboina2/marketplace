'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Skeleton } from 'antd';
import type { ProductResponse, SearchProducts } from '@marketplace/contracts';
import { listProducts, searchProducts } from '../../../lib/api/products';
import { toAttributes } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { useAuth } from '../../../lib/auth/auth-context';
import { notifyProblem } from '../../../lib/problem-notify';
import { FilterRail, ProductGrid } from '../../../components/filter-rail';
import { ProductCard } from '../../../components/product-card';
import { StorefrontHero } from '../../../components/storefront-hero';
import { EmptyState } from '../../../components/empty-state';

type Filters = Pick<SearchProducts, 'priceMinorMin' | 'priceMinorMax' | 'attributes'>;

const PAGE = 25;

export default function ProductsPage() {
  const schema = useSchema('Product');
  const { principal } = useAuth();

  const [items, setItems] = useState<ProductResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<Filters | null>(null);

  // Unfiltered browsing uses GET /products; the moment any filter is set it
  // switches to POST /products/search, the only endpoint that can match on
  // dynamic attributes. Unchanged from before the redesign.
  const fetchPage = useCallback(
    async (from: string | null, append: boolean, active: Filters | null) => {
      setLoading(true);
      try {
        const page = active
          ? await searchProducts({
              ...active,
              attributes: active.attributes ?? {},
              limit: PAGE,
              cursor: from,
            })
          : await listProducts(PAGE, from);

        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
      } catch (err) {
        notifyProblem(err);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    void fetchPage(null, false, filters);
  }, [fetchPage, filters]);

  const apply = (values: Record<string, unknown>) => {
    const attributes = schema
      ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
      : {};
    setFilters({
      priceMinorMin: values.priceMinorMin as number | undefined,
      priceMinorMax: values.priceMinorMax as number | undefined,
      attributes: attributes as SearchProducts['attributes'],
    });
  };

  return (
    <>
      <StorefrontHero tenantId={principal?.tenantId ?? ''} products={items} />

      <div className="mp-shop-layout">
        <FilterRail
          fields={schema?.fields ?? null}
          onApply={apply}
          onClear={() => setFilters(null)}
        />

        <div className="mp-shop-results">
          {loading && items.length === 0 ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : items.length === 0 ? (
            <EmptyState
              title="No products match"
              description={
                filters
                  ? 'Try clearing the filters.'
                  : 'This catalogue is empty. An admin can add the first product.'
              }
            />
          ) : (
            <>
              <ProductGrid>
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </ProductGrid>
              {!done && (
                <Button
                  style={{ marginTop: 16 }}
                  loading={loading}
                  onClick={() => void fetchPage(cursor, true, filters)}
                >
                  Load more
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
