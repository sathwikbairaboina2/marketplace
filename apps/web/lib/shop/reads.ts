'use client';

import { useMemo } from 'react';
import type {
  Announcement,
  DepositPolicy,
  ShopContact,
  EventResponse,
  Page,
  ProductResponse,
  SchemaList,
  SearchProducts,
  StorefrontConfig,
} from '@marketplace/contracts';
import { getEvent, listEvents } from '../api/events';
import { getProduct, listProducts, searchProducts } from '../api/products';
import { getAnnouncement, getDepositPolicy, getShopContact } from '../api/settings';
import { listSchemas } from '../api/schemas';
import { getPublishedStorefront } from '../api/storefront';
import * as pub from '../api/shop';
import { useShop, type Shop } from './shop-context';

export interface ShopReads {
  listProducts(limit: number, cursor: string | null): Promise<Page<ProductResponse>>;
  searchProducts(body: SearchProducts): Promise<Page<ProductResponse>>;
  getProduct(id: string): Promise<ProductResponse>;
  listEvents(limit: number, cursor: string | null): Promise<Page<EventResponse>>;
  getEvent(id: string): Promise<EventResponse>;
  getStorefront(): Promise<StorefrontConfig | null>;
  getAnnouncement(): Promise<Announcement>;
  getContact(): Promise<ShopContact>;
  getDepositPolicy(): Promise<DepositPolicy>;
  listSchemas(): Promise<SchemaList>;
}

/**
 * One object, two bindings. On a shop host every read is public and names
 * the tenant in its path; on the platform host every read is the token route
 * it always was. Pages call the object and never learn which.
 */
export function readsFor(shop: Shop | null): ShopReads {
  // Wrapped rather than passed through, so a wrapper is only resolved when
  // it is called: a unit test that mocks one wrapper of a module is not made
  // to mock every other export the module happens to have.
  if (!shop) {
    return {
      listProducts: (limit, cursor) => listProducts(limit, cursor),
      searchProducts: (body) => searchProducts(body),
      getProduct: (id) => getProduct(id),
      listEvents: (limit, cursor) => listEvents(limit, cursor),
      getEvent: (id) => getEvent(id),
      getStorefront: () => getPublishedStorefront(),
      getAnnouncement: () => getAnnouncement(),
      getContact: () => getShopContact(),
      getDepositPolicy: () => getDepositPolicy(),
      listSchemas: () => listSchemas(),
    };
  }
  const t = shop.tenantId;
  return {
    listProducts: (limit, cursor) => pub.publicListProducts(t, limit, cursor),
    searchProducts: (body) => pub.publicSearchProducts(t, body),
    getProduct: (id) => pub.publicGetProduct(t, id),
    listEvents: (limit, cursor) => pub.publicListEvents(t, limit, cursor),
    getEvent: (id) => pub.publicGetEvent(t, id),
    getStorefront: () => pub.publicGetStorefront(t),
    getAnnouncement: () => pub.publicGetAnnouncement(t),
    getContact: () => pub.publicGetContact(t),
    getDepositPolicy: () => pub.publicGetDepositPolicy(t),
    listSchemas: () => pub.publicListSchemas(t),
  };
}

/**
 * Memoised on the shop object, which the provider creates once per mount, so
 * a page may put the result in an effect's dependency list without refetching
 * every render.
 */
export function useShopReads(): ShopReads {
  const shop = useShop();
  return useMemo(() => readsFor(shop ?? null), [shop]);
}
