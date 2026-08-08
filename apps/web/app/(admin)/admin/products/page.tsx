'use client';

import Link from 'next/link';
import { Button } from 'antd';
import type { ProductResponse } from '@marketplace/contracts';
import { listProducts } from '../../../../lib/api/products';
import { formatMoney } from '../../../../lib/format';
import { CursorTable } from '../../../../components/cursor-table';
import { PageHeader } from '../../../../components/page-header';
import { EmptyState } from '../../../../components/empty-state';
import { StatusTag } from '../../../../components/status-tag';
import { placeholderFor } from '../../../../lib/placeholder';

export default function AdminProductsPage() {
  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Everything in this tenant's catalogue"
        extra={
          <Link href="/admin/products/new">
            <Button type="primary">New product</Button>
          </Link>
        }
      />

      <CursorTable<ProductResponse>
        rowKey="id"
        caption="Products in this tenant's catalogue"
        noun={{ one: 'product', many: 'products' }}
        load={(cursor) => listProducts(25, cursor)}
        empty={
          <EmptyState
            title="No products yet"
            description="Create the first one to see it in the storefront."
            action={
              <Link href="/admin/products/new">
                <Button type="primary">New product</Button>
              </Link>
            }
          />
        }
        columns={[
          {
            title: '',
            dataIndex: 'images',
            width: 56,
            render: (images: string[], row) => {
              const { gradient, initials } = placeholderFor(row.id, row.name);
              return images[0] ? (
                <img
                  src={images[0]}
                  alt=""
                  className="mp-table-thumb"
                />
              ) : (
                <span className="mp-thumb-placeholder" style={{ background: gradient }}>
                  {initials}
                </span>
              );
            },
          },
          {
            title: 'Name',
            dataIndex: 'name',
            // Links to the storefront detail page: there is no admin detail
            // route, and the storefront one already shows everything an admin
            // would look at. Following it crosses into the shop shell, which is
            // expected rather than accidental.
            render: (name: string, row) => <Link href={`/products/${row.id}`}>{name}</Link>,
          },
          { title: 'Category', dataIndex: 'category' },
          {
            title: 'Price',
            dataIndex: 'priceMinor',
            className: 'mp-num',
            render: (minor: number, row) =>
              `${formatMoney(minor)} ${row.currency}`,
          },
          { title: 'Stock', dataIndex: 'stock', className: 'mp-num' },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (status: string) => <StatusTag status={status} />,
          },
        ]}
      />
    </>
  );
}
