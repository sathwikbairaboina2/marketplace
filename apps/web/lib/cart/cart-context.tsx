'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { CartResponse } from '@marketplace/contracts';
import { clearCart, getCart, putCartLine } from '../api/cart';
import { notifyProblem } from '../problem-notify';
import { useAuth } from '../auth/auth-context';

const KEY_KEY = 'marketplace.cart.idempotencyKey';
const EMPTY: CartResponse = { lines: [], totalMinor: 0 };

interface CartValue {
  cart: CartResponse;
  add: (productId: string, qty: number) => Promise<void>;
  setQty: (productId: string, qty: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
  idempotencyKey: string;
  resetKey: () => void;
}

const CartContext = createContext<CartValue | null>(null);

/**
 * The cart lives on the engine, one per buyer: it survives reload, tab close
 * and device switch. This provider keeps a local mirror, applies quantity
 * edits optimistically, and reconciles with the resolved cart every mutation
 * returns. Only the idempotency key stays in sessionStorage -- it belongs to
 * the checkout *intent*, minted once and reused by every retry.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const [cart, setCart] = useState<CartResponse>(EMPTY);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  useEffect(() => {
    const storedKey = sessionStorage.getItem(KEY_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, storedKey);
    setIdempotencyKey(storedKey);
  }, []);

  // The cart is the signed-in user's; fetch when a session exists, and drop
  // the mirror when it ends so the next user never sees the previous cart.
  useEffect(() => {
    if (!token) {
      setCart(EMPTY);
      return;
    }
    getCart().then(setCart).catch(notifyProblem);
  }, [token]);

  /** A failed write leaves the server authoritative: refetch, then report. */
  const recover = useCallback((err: unknown) => {
    getCart()
      .then(setCart)
      .catch(() => setCart(EMPTY));
    notifyProblem(err);
  }, []);

  const add = useCallback(
    async (productId: string, qty: number) => {
      const existing = cart.lines.find((l) => l.productId === productId);
      try {
        setCart(await putCartLine(productId, (existing?.qty ?? 0) + qty));
      } catch (err) {
        recover(err);
      }
    },
    [cart.lines, recover],
  );

  const setQty = useCallback(
    async (productId: string, qty: number) => {
      // Optimistic: the row follows the spinner immediately; the server's
      // resolved cart replaces it a beat later.
      setCart((prev) => ({
        ...prev,
        lines: prev.lines.map((l) => (l.productId === productId ? { ...l, qty } : l)),
      }));
      try {
        setCart(await putCartLine(productId, qty));
      } catch (err) {
        recover(err);
      }
    },
    [recover],
  );

  const remove = useCallback(
    async (productId: string) => {
      setCart((prev) => ({
        ...prev,
        lines: prev.lines.filter((l) => l.productId !== productId),
      }));
      try {
        setCart(await putCartLine(productId, 0));
      } catch (err) {
        recover(err);
      }
    },
    [recover],
  );

  const clear = useCallback(async () => {
    setCart(EMPTY);
    try {
      setCart(await clearCart());
    } catch (err) {
      recover(err);
    }
  }, [recover]);

  /** Call only after a successful order, or an explicit abandon. */
  const resetKey = useCallback(() => {
    const next = crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, next);
    setIdempotencyKey(next);
  }, []);

  return (
    <CartContext.Provider value={{ cart, add, setQty, remove, clear, idempotencyKey, resetKey }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
