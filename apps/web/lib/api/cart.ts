import { CartResponseSchema, type CartResponse } from '@marketplace/contracts';
import { request } from './http';

export const getCart = (): Promise<CartResponse> => request('/cart', { schema: CartResponseSchema });

export const putCartLine = (productId: string, qty: number): Promise<CartResponse> =>
  request(`/cart/lines/${productId}`, { method: 'PUT', body: { qty }, schema: CartResponseSchema });

export const clearCart = (): Promise<CartResponse> =>
  request('/cart', { method: 'DELETE', schema: CartResponseSchema });

/** After sign-in on a shop host: the cart built as a stranger joins this account's. */
export const mergeGuestCart = (guest: string): Promise<CartResponse> =>
  request('/cart/merge', { method: 'POST', body: { guest }, schema: CartResponseSchema });
