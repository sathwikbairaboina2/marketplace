'use client';

import Link from 'next/link';
import { Alert, Button, Card, Statistic, Table } from 'antd';
import type { SalesStats } from '@marketplace/contracts';
import { getSalesStats } from '../../../../lib/api/stats';
import { useResource } from '../../../../lib/use-resource';
import { formatMoney, formatPrice } from '../../../../lib/format';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { ErrorPanel } from '../../../../components/error-panel';
import { DetailSkeleton } from '../../../../components/skeletons';

/**
 * The shop's numbers, aggregated on read: order counts, revenue per currency,
 * what sells, and what is about to run out. Whole-shop and current -- no time
 * windows until somebody needs them.
 */
export default function DashboardPage() {
  const { data: stats, error, loading, retry } = useResource<SalesStats>(getSalesStats, []);

  if (loading) return <DetailSkeleton />;
  if (error) return <ErrorPanel error={error} onRetry={retry} />;
  if (!stats) return null;

  const revenues = Object.entries(stats.revenueMinorByCurrency);
  const empty = stats.orders.total === 0 && revenues.length === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="The whole shop, right now — orders, revenue, what sells, what's running out"
      />

      {stats.truncated && (
        <Alert
          type="warning"
          showIcon
          message="Large shop"
          description="The scan stopped at its page budget, so these numbers are a floor, not a total."
          style={{ marginBottom: 16 }}
        />
      )}

      {empty ? (
        <EmptyState
          title="No sales yet"
          description="Once orders start arriving, their numbers appear here."
          action={
            <Link href="/admin/products">
              <Button type="primary">Go to products</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="mp-stat-row" data-testid="order-stats">
            <Card>
              <Statistic title="Orders" value={stats.orders.total} />
            </Card>
            <Card>
              <Statistic title="Paid" value={stats.orders.confirmed} />
            </Card>
            <Card>
              <Statistic title="Awaiting payment" value={stats.orders.awaitingPayment} />
            </Card>
            <Card>
              <Statistic title="Cancelled" value={stats.orders.cancelled} />
            </Card>
            {/* One card per currency: adding yen to euros produces a number
                that means nothing, so nothing here sums across them. */}
            {revenues.map(([currency, minor]) => (
              <Card key={currency}>
                <Statistic title={`Revenue (${currency})`} value={formatMoney(minor, currency)} />
              </Card>
            ))}
          </div>

          <div className="mp-dashboard-tables">
            <section>
              <h2>Top products</h2>
              <Table
                rowKey="productId"
                pagination={false}
                size="small"
                dataSource={stats.topProducts}
                locale={{ emptyText: 'Nothing sold yet' }}
                columns={[
                  {
                    title: 'Product',
                    dataIndex: 'name',
                    render: (name: string, row) => (
                      <Link href={`/products/${row.productId}`}>{name}</Link>
                    ),
                  },
                  { title: 'Units', dataIndex: 'units', align: 'right', width: 90 },
                  {
                    title: 'Revenue',
                    dataIndex: 'revenueMinor',
                    align: 'right',
                    width: 150,
                    render: (minor: number, row) => formatPrice(minor, row.currency),
                  },
                ]}
              />
            </section>

            <section>
              <h2>Low stock</h2>
              <Table
                rowKey="id"
                pagination={false}
                size="small"
                dataSource={stats.lowStock}
                locale={{ emptyText: 'Nothing is running low' }}
                columns={[
                  {
                    title: 'Product',
                    dataIndex: 'name',
                    render: (name: string, row) => (
                      <Link href={`/admin/products/${row.id}/edit`}>{name}</Link>
                    ),
                  },
                  { title: 'Stock left', dataIndex: 'stock', align: 'right', width: 110 },
                ]}
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}
