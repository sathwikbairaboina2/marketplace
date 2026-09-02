import {
  AnnouncementSchema,
  EventResponseSchema,
  ProductResponseSchema,
  SchemaListSchema,
  StorefrontPublicResponseSchema,
  type SearchProducts,
  pageOf,
} from '@marketplace/contracts';
import { request } from './http';

/**
 * The public read surface: what a stranger may see of one shop. Same
 * contracts as the token wrappers, different route -- the engine, not this
 * client, decides what is visible.
 */
const Products = pageOf(ProductResponseSchema);
const Events = pageOf(EventResponseSchema);
const base = (tenantId: string) => `/shops/${encodeURIComponent(tenantId)}`;

export const publicListProducts = (tenantId: string, limit: number, cursor: string | null) =>
  request(`${base(tenantId)}/products`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Products,
  });

export const publicSearchProducts = (tenantId: string, body: SearchProducts) =>
  request(`${base(tenantId)}/products/search`, { method: 'POST', body, schema: Products });

export const publicGetProduct = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/products/${id}`, { schema: ProductResponseSchema });

export const publicListEvents = (tenantId: string, limit: number, cursor: string | null) =>
  request(`${base(tenantId)}/events`, {
    query: { limit, cursor: cursor ?? undefined },
    schema: Events,
  });

export const publicGetEvent = (tenantId: string, id: string) =>
  request(`${base(tenantId)}/events/${id}`, { schema: EventResponseSchema });

export const publicGetStorefront = (tenantId: string) =>
  request(`${base(tenantId)}/storefront`, { schema: StorefrontPublicResponseSchema }).then(
    (res) => res.config,
  );

export const publicGetAnnouncement = (tenantId: string) =>
  request(`${base(tenantId)}/announcement`, { schema: AnnouncementSchema });

export const publicListSchemas = (tenantId: string) =>
  request(`${base(tenantId)}/schemas`, { schema: SchemaListSchema });
