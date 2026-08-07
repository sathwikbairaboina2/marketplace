import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { SchemaView } from '@marketplace/contracts';
import { SchemaProvider, useSchema, useSchemas } from './schema-cache';
import * as api from '../api/schemas';

vi.mock('../auth/auth-context', () => ({
  useAuth: () => ({ token: 'tok' }),
  getToken: () => 'tok',
}));

const view = (entityType: string, version: number, names: string[]): SchemaView =>
  ({
    entityType,
    version,
    fields: Object.fromEntries(
      names.map((n) => [n, { type: 'string', required: false, default: null }]),
    ),
  }) as SchemaView;

function Probe() {
  const product = useSchema('Product');
  const order = useSchema('Order');
  const { refresh, loading } = useSchemas();
  return (
    <div>
      <span data-testid="product">{Object.keys(product?.fields ?? {}).join(',')}</span>
      <span data-testid="order">{order?.entityType ?? 'none'}</span>
      <span data-testid="loading">{String(loading)}</span>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  );
}

describe('SchemaProvider', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('fetches every schema in one call and exposes them by entity type', async () => {
    const spy = vi.spyOn(api, 'listSchemas').mockResolvedValue({
      items: [view('Product', 1, ['colour']), view('Order', 1, [])],
    });

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});

    // One call, not one per entity type: GET /schemas returns all four.
    expect(spy).toHaveBeenCalledOnce();
    expect(screen.getByTestId('product')).toHaveTextContent('colour');
    expect(screen.getByTestId('order')).toHaveTextContent('Order');
  });

  it('re-reads after refresh, so a newly executed flow shows its field', async () => {
    const spy = vi
      .spyOn(api, 'listSchemas')
      .mockResolvedValueOnce({ items: [view('Product', 1, ['colour'])] })
      .mockResolvedValueOnce({ items: [view('Product', 2, ['colour', 'weight'])] });

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});
    await act(async () => {
      screen.getByText('refresh').click();
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('product')).toHaveTextContent('colour,weight');
  });

  it('returns null for an entity type the server did not send', async () => {
    vi.spyOn(api, 'listSchemas').mockResolvedValue({ items: [view('Product', 1, ['colour'])] });

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});

    expect(screen.getByTestId('order')).toHaveTextContent('none');
  });

  it('clears loading even when the fetch fails', async () => {
    vi.spyOn(api, 'listSchemas').mockRejectedValue(new Error('boom'));

    render(
      <SchemaProvider>
        <Probe />
      </SchemaProvider>,
    );
    await act(async () => {});

    // A stuck `loading` would leave every generated form spinning forever.
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });
});
