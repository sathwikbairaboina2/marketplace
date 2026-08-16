import {
  type CreateProduct,
  type UpdateProduct,
  ProductResponseSchema,
  type SearchProducts,
  pageOf,
} from '@marketplace/contracts';
import { request } from './http';

const Page = pageOf(ProductResponseSchema);

export const listProducts = (limit: number, cursor: string | null) =>
  request('/products', { query: { limit, cursor: cursor ?? undefined }, schema: Page });

export const searchProducts = (body: SearchProducts) =>
  request('/products/search', { method: 'POST', body, schema: Page });

export const getProduct = (id: string) =>
  request(`/products/${id}`, { schema: ProductResponseSchema });

export const createProduct = (body: CreateProduct) =>
  request('/products', { method: 'POST', body, schema: ProductResponseSchema });

export const updateProduct = (id: string, body: UpdateProduct) =>
  request(`/products/${id}`, { method: 'PATCH', body, schema: ProductResponseSchema });
