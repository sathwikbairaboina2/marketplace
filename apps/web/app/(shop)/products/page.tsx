'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import type { ProductResponse, SearchProducts } from '@marketplace/contracts';
import { listProducts, searchProducts } from '../../../lib/api/products';
import { toAttributes } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';
import { useAuth } from '../../../lib/auth/auth-context';
import { notifyProblem } from '../../../lib/problem-notify';
import { FilterRail, ProductGrid } from '../../../components/filter-rail';
import { ProductCard } from '../../../components/product-card';
import { StorefrontBanner } from '../../../components/storefront-banner';
import { StorefrontHero } from '../../../components/storefront-hero';
import { useStorefrontConfig } from '../../../lib/storefront-config';
import { EmptyState } from '../../../components/empty-state';
import { ErrorPanel } from '../../../components/error-panel';
import { GridSkeleton } from '../../../components/skeletons';

type Filters = Pick<SearchProducts, 'text' | 'priceMinorMin' | 'priceMinorMax' | 'attributes'>;

const PAGE = 25;

/**
 * What a shopper is allowed to see.
 *
 * `GET /products` returns every status, because the same route serves the
 * seller's own cockpit — so a draft (a half-written listing) and an archived
 * product (one deliberately withdrawn) were both being rendered in the shop
 * window, priced and clickable.
 *
 * Filtered here rather than in the query: `SearchProducts` can express one
 * status, not "any of these", and its filter is applied by DynamoDB *after* the
 * page is read, so asking the engine would trade a leak for short pages. When
 * the catalogue is indexed by status, this belongs in the query instead.
 */
const SHOPPER_VISIBLE: ReadonlySet<string> = new Set(['active', 'out_of_stock']);
const onSale = (products: ProductResponse[]) =>
  products.filter((product) => SHOPPER_VISIBLE.has(product.status));

export default function ProductsPage() {
  const schema = useSchema('Product');
  const { principal } = useAuth();
  const storefront = useStorefrontConfig();
  const hero = storefront?.banners.find((b) => b.slot === 'hero');
  const mid = storefront?.banners.find((b) => b.slot === 'mid');
  const footer = storefront?.banners.find((b) => b.slot === 'footer');

  const [items, setItems] = useState<ProductResponse[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
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

        const visible = onSale(page.items);
        setItems((prev) => (append ? [...prev, ...visible] : visible));
        setCursor(page.nextCursor);
        setDone(page.nextCursor === null);
        setError(null);
      } catch (err) {
        setError(err);
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
    setError(null);
    void fetchPage(null, false, filters);
  }, [fetchPage, filters]);

  const apply = (values: Record<string, unknown>) => {
    const attributes = schema
      ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
      : {};
    // An empty search box means "no text filter", not "match the empty string"
    // -- the schema's min(1) would refuse it.
    const text = typeof values.text === 'string' ? values.text.trim() : '';
    setFilters({
      text: text.length > 0 ? text : undefined,
      priceMinorMin: values.priceMinorMin as number | undefined,
      priceMinorMax: values.priceMinorMax as number | undefined,
      attributes: attributes as SearchProducts['attributes'],
    });
  };

  return (
    <>
      {/* A published hero banner replaces the stats hero: the owner chose
          words for this band, and the stats move aside for them. */}
      {hero ? (
        <StorefrontBanner banner={hero} />
      ) : (
        <StorefrontHero
          tenantId={principal?.tenantId ?? ''}
          products={items}
          known={!loading && !error}
        />
      )}

      <div className="mp-shop-layout">
        <FilterRail
          fields={schema?.fields ?? null}
          onApply={apply}
          onClear={() => setFilters(null)}
        />

        <div className="mp-shop-results" aria-busy={loading || undefined}>
          {loading && items.length === 0 ? (
            <GridSkeleton />
          ) : error && items.length === 0 ? (
            <ErrorPanel error={error} onRetry={() => void fetchPage(null, false, filters)} />
          ) : items.length === 0 ? (
            <EmptyState
              title={filters ? 'No products match' : 'This shop is just getting started'}
              description={
                filters
                  ? 'Nothing in the shop matches every filter you set.'
                  : 'Nothing has been listed yet — check back soon.'
              }
              action={
                filters ? (
                  <Button type="primary" onClick={() => setFilters(null)}>
                    Clear filters
                  </Button>
                ) : (
                  <Link href="/events">
                    <Button type="primary">Browse events</Button>
                  </Link>
                )
              }
            />
          ) : (
            <>
              <div className="mp-results-bar">
                {/* Polite, not assertive: filtering is something the reader
                    just did, so the count is a confirmation, not an
                    interruption. */}
                <span className="mp-results-count" aria-live="polite">
                  {items.length} product{items.length === 1 ? '' : 's'}
                  {filters ? ' matching your filters' : ''}
                </span>
              </div>
              <ProductGrid>
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </ProductGrid>
              {/* A failed *later* page keeps the results already on screen --
                  losing four pages because the fifth timed out is worse than
                  the failure itself. */}
              {error && (
                <ErrorPanel error={error} onRetry={() => void fetchPage(cursor, true, filters)} />
              )}
              {!done && !error && (
                <Button
                  style={{ marginTop: 'var(--mp-space-6)' }}
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

      {mid && <StorefrontBanner banner={mid} />}
      {footer && <StorefrontBanner banner={footer} />}
    </>
  );
}
