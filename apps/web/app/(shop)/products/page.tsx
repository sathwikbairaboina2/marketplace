'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button, Card, Form, InputNumber, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ProductResponse, SearchProducts } from '@marketplace/contracts';
import { listProducts, searchProducts } from '../../../lib/api/products';
import { CursorTable } from '../../../components/cursor-table';
import { StatusTag } from '../../../components/status-tag';
import { toAttributes, toFilterItems } from '../../../lib/schema-fields';
import { useSchema } from '../../../lib/schemas/schema-cache';

type Filters = Pick<SearchProducts, 'priceMinorMin' | 'priceMinorMax' | 'attributes'>;

export default function ProductsPage() {
  const schema = useSchema('Product');
  const [filters, setFilters] = useState<Filters | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Unfiltered browsing uses GET /products; the moment any filter is set it
  // switches to POST /products/search, which is the only endpoint that can
  // match on dynamic attributes.
  const load = useCallback(
    (cursor: string | null) =>
      filters
        ? searchProducts({ ...filters, attributes: filters.attributes ?? {}, limit: 25, cursor })
        : listProducts(25, cursor),
    [filters],
  );

  const columns = useMemo<ColumnsType<ProductResponse>>(
    () => [
      {
        title: '',
        dataIndex: 'images',
        width: 56,
        render: (images: string[]) =>
          images[0] ? (
            <img
              src={images[0]}
              alt=""
              width={40}
              height={40}
              style={{ objectFit: 'cover', borderRadius: 4 }}
            />
          ) : null,
      },
      {
        title: 'Name',
        dataIndex: 'name',
        render: (name: string, row) => <Link href={`/products/${row.id}`}>{name}</Link>,
      },
      { title: 'Category', dataIndex: 'category' },
      {
        title: 'Price',
        dataIndex: 'priceMinor',
        render: (minor: number, row) => `${(minor / 100).toFixed(2)} ${row.currency}`,
      },
      { title: 'Stock', dataIndex: 'stock' },
      {
        title: 'Status',
        dataIndex: 'status',
        render: (status: string) => <StatusTag status={status} />,
      },
    ],
    [],
  );

  const apply = (values: Record<string, unknown>) => {
    const attributes = schema
      ? toAttributes(schema.fields, (values.attributes ?? {}) as Record<string, unknown>)
      : {};
    setFilters({
      priceMinorMin: values.priceMinorMin as number | undefined,
      priceMinorMax: values.priceMinorMax as number | undefined,
      attributes: attributes as SearchProducts['attributes'],
    });
    setReloadToken((n) => n + 1);
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <Card title="Filters" size="small">
        <Form layout="inline" onFinish={apply}>
          <Form.Item name="priceMinorMin" label="Min price (minor)">
            <InputNumber min={0} />
          </Form.Item>
          <Form.Item name="priceMinorMax" label="Max price (minor)">
            <InputNumber min={0} />
          </Form.Item>
          {/* Generated from the tenant's registry: a field added by a flow
              becomes a filter here with no code change. */}
          {schema ? toFilterItems(schema.fields) : null}
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Search
              </Button>
              <Button
                onClick={() => {
                  setFilters(null);
                  setReloadToken((n) => n + 1);
                }}
              >
                Clear
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
      <CursorTable<ProductResponse>
        rowKey="id"
        columns={columns}
        load={load}
        reloadToken={reloadToken}
      />
    </Space>
  );
}
