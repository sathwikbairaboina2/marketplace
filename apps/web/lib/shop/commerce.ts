'use client';

import { useMemo } from 'react';
import type {
  BookingResponse,
  Card,
  CartResponse,
  CheckoutRequest,
  CreateBooking,
  OrderResponse,
} from '@marketplace/contracts';
import { clearCart, getCart, mergeGuestCart, putCartLine } from '../api/cart';
import { checkout, payOrder } from '../api/checkout';
import { createBooking, getBooking } from '../api/bookings';
import { cancelOrder, getOrder } from '../api/orders';
import * as pub from '../api/shop';
import { useAuth } from '../auth/auth-context';
import { readGuestTicket, writeGuestTicket } from '../guest/guest-ticket';
import { useShop, type Shop } from './shop-context';

/**
 * The buying half of the storefront, bound one of two ways. With a session,
 * every call is the token route it always was. On a shop host with no
 * session, every call is the guest route under /shops/:tenantId carrying the
 * stranger's ticket -- minted on first use and kept in this browser. Pages
 * call the object and never learn which; `guest` is true so the cart page
 * can ask a stranger for the one thing a buyer already has, an email.
 */
export interface ShopCommerce {
  /** True when the caller is a stranger buying on a ticket. */
  guest: boolean;
  /** The ticket, once one exists; what sign-in hands to the merge. */
  ticket(): string | null;
  /**
   * The cart this browser built as a stranger, folded into the signed-in
   * account's and the ticket spent. Null when there is nothing to adopt --
   * no ticket, or a caller who is still a stranger.
   */
  adoptGuestCart(): Promise<CartResponse | null>;
  getCart(): Promise<CartResponse>;
  putLine(productId: string, qty: number): Promise<CartResponse>;
  clearCart(): Promise<CartResponse>;
  checkout(body: CheckoutRequest, idempotencyKey: string, email?: string): Promise<OrderResponse>;
  getOrder(id: string): Promise<OrderResponse>;
  /** `email` is the lookup key, for a shopper who no longer holds the ticket. */
  payOrder(id: string, card: Card, email?: string): Promise<OrderResponse>;
  cancelOrder(id: string, email?: string): Promise<OrderResponse>;
  /**
   * Booking a class. `email` is required of a stranger and ignored for a
   * signed-in buyer, whose account already carries one -- the page asks for it
   * only when `guest` is true, exactly as the cart does.
   */
  book(
    body: CreateBooking,
    idempotencyKey: string,
    email?: string,
    name?: string,
    phone?: string,
  ): Promise<BookingResponse>;
  getBooking(id: string): Promise<BookingResponse>;
}

const EMPTY: CartResponse = { lines: [], totalMinor: 0 };

export function commerceFor(shop: Shop | null, signedIn: boolean): ShopCommerce {
  if (signedIn || !shop) {
    return {
      guest: false,
      ticket: () => (shop ? readGuestTicket(shop.tenantId) : null),
      // Best effort, and the ticket is kept. It used to be spent here, on the
      // reasoning that the next stranger in this browser should not inherit
      // our cart -- but the merge empties the guest cart on the engine, so
      // there is nothing left to inherit, and the ticket is also the only key
      // to any order this browser placed as a stranger. Spending it turned an
      // unpaid order into one nobody could pay for and nobody but the seller
      // could cancel, with its stock reserved the whole time.
      adoptGuestCart: async () => {
        const ticket = shop && signedIn ? readGuestTicket(shop.tenantId) : null;
        if (!shop || !ticket) return null;
        try {
          return await mergeGuestCart(ticket);
        } catch {
          return null;
        }
      },
      // On the platform host with no session there is no cart to ask for,
      // and asking would answer 401 -- which the shell turns into a trip to
      // the login page for a visitor who was only ever going there anyway.
      getCart: () => (signedIn ? getCart() : Promise.resolve(EMPTY)),
      putLine: (productId, qty) => putCartLine(productId, qty),
      clearCart: () => clearCart(),
      checkout: (body, key) => checkout(body, key),
      getOrder: (id) => getOrder(id),
      payOrder: (id, card) => payOrder(id, card),
      cancelOrder: (id) => cancelOrder(id),
      book: (body, key) => createBooking(body, key),
      getBooking: (id) => getBooking(id),
    };
  }
  const t = shop.tenantId;
  // A ticket is minted only when something needs it: a stranger who only
  // looks never gets one, and never gets a cart record either.
  const ensure = async (): Promise<string> => {
    const existing = readGuestTicket(t);
    if (existing) return existing;
    const minted = await pub.guestMint(t);
    writeGuestTicket(t, minted);
    return minted;
  };
  return {
    guest: true,
    ticket: () => readGuestTicket(t),
    // Still a stranger: there is no account for the cart to join.
    adoptGuestCart: async () => null,
    // No ticket yet means no cart yet, and that is an answer, not a request.
    getCart: async () => {
      const ticket = readGuestTicket(t);
      return ticket ? pub.guestGetCart(t, ticket) : EMPTY;
    },
    putLine: async (productId, qty) => pub.guestPutCartLine(t, await ensure(), productId, qty),
    clearCart: async () => {
      const ticket = readGuestTicket(t);
      return ticket ? pub.guestClearCart(t, ticket) : EMPTY;
    },
    checkout: async (body, key, email) => {
      if (!email) throw new Error('a guest checkout needs an email');
      return pub.guestCheckout(t, await ensure(), { ...body, email }, key);
    },
    getOrder: async (id) => pub.guestGetOrder(t, await ensure(), id),
    payOrder: async (id, card, email) => pub.guestPayOrder(t, await ensure(), id, card, email),
    cancelOrder: async (id, email) => pub.guestCancelOrder(t, await ensure(), id, email),
    book: async (body, key, email, name, phone) => {
      if (!email || !name || !phone) {
        throw new Error('a guest booking needs a name, a phone number and an email');
      }
      return pub.guestBook(t, await ensure(), { ...body, email, name, phone }, key);
    },
    getBooking: async (id) => pub.guestGetBooking(t, await ensure(), id),
  };
}

export function useShopCommerce(): ShopCommerce {
  const shop = useShop();
  // The token, not the principal: it is what the token routes send, and it
  // is restored before the principal is derived from it.
  const { token } = useAuth();
  return useMemo(() => commerceFor(shop ?? null, Boolean(token)), [shop, token]);
}
