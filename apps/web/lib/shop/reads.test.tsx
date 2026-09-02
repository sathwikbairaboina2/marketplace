import { describe, expect, it, vi } from 'vitest';

vi.mock('../api/products', () => ({
  listProducts: vi.fn(() => 'token-list'),
  searchProducts: vi.fn(),
  getProduct: vi.fn(() => 'token-get'),
}));
vi.mock('../api/events', () => ({ listEvents: vi.fn(), getEvent: vi.fn() }));
vi.mock('../api/settings', () => ({ getAnnouncement: vi.fn() }));
vi.mock('../api/schemas', () => ({ listSchemas: vi.fn(() => 'token-schemas') }));
vi.mock('../api/storefront', () => ({ getPublishedStorefront: vi.fn() }));
vi.mock('../api/shop', () => ({
  publicListProducts: vi.fn((tenantId: string, limit: number) => `public-list:${tenantId}:${limit}`),
  publicSearchProducts: vi.fn(),
  publicGetProduct: vi.fn((tenantId: string, id: string) => `public-get:${tenantId}:${id}`),
  publicListEvents: vi.fn(),
  publicGetEvent: vi.fn(),
  publicGetStorefront: vi.fn(),
  publicGetAnnouncement: vi.fn(),
  publicListSchemas: vi.fn((tenantId: string) => `public-schemas:${tenantId}`),
}));

import { readsFor } from './reads';

describe('readsFor', () => {
  it('binds the public wrappers to the host tenant', () => {
    const reads = readsFor({ tenantId: 'acme' });
    expect(reads.listProducts(5, null)).toBe('public-list:acme:5');
    expect(reads.getProduct('p1')).toBe('public-get:acme:p1');
    expect(reads.listSchemas()).toBe('public-schemas:acme');
  });

  it('uses the token wrappers on the platform host', () => {
    const reads = readsFor(null);
    expect(reads.listProducts(5, null)).toBe('token-list');
    expect(reads.getProduct('p1')).toBe('token-get');
    expect(reads.listSchemas()).toBe('token-schemas');
  });

  it('exposes the same eight reads on both sides', () => {
    expect(Object.keys(readsFor(null)).sort()).toEqual(Object.keys(readsFor({ tenantId: 'x' })).sort());
  });
});
