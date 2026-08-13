'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface CartLine {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
  /** First product image. Optional so lines persisted before it existed still parse. */
  image?: string;
}

const LINES_KEY = 'marketplace.cart';
const KEY_KEY = 'marketplace.cart.idempotencyKey';

interface CartValue {
  lines: CartLine[];
  add: (line: CartLine) => void;
  setQty: (productId: string, qty: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  idempotencyKey: string;
  resetKey: () => void;
}

const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const persist = useCallback((next: CartLine[]) => {
    sessionStorage.setItem(LINES_KEY, JSON.stringify(next));
    return next;
  }, []);

  useEffect(() => {
    const storedLines = sessionStorage.getItem(LINES_KEY);
    if (storedLines) setLines(JSON.parse(storedLines) as CartLine[]);

    // The key belongs to the *intent*, not to the click. It is minted once and
    // reused by every retry -- a double-click, a 409 request-in-progress
    // backoff, and a retry after a dropped connection all send the same key, so
    // the engine replays the first response instead of creating a second order.
    const storedKey = sessionStorage.getItem(KEY_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, storedKey);
    setIdempotencyKey(storedKey);
  }, []);

  const add = useCallback(
    (line: CartLine) =>
      setLines((prev) => {
        const existing = prev.find((l) => l.productId === line.productId);
        return persist(
          existing
            ? prev.map((l) =>
                l.productId === line.productId ? { ...l, qty: l.qty + line.qty } : l,
              )
            : [...prev, line],
        );
      }),
    [persist],
  );

  const setQty = useCallback(
    (productId: string, qty: number) =>
      setLines((prev) => persist(prev.map((l) => (l.productId === productId ? { ...l, qty } : l)))),
    [persist],
  );

  const remove = useCallback(
    (productId: string) =>
      setLines((prev) => persist(prev.filter((l) => l.productId !== productId))),
    [persist],
  );

  const clear = useCallback(() => setLines(() => persist([])), [persist]);

  /** Call only after a successful order, or an explicit abandon. */
  const resetKey = useCallback(() => {
    const next = crypto.randomUUID();
    sessionStorage.setItem(KEY_KEY, next);
    setIdempotencyKey(next);
  }, []);

  return (
    <CartContext.Provider value={{ lines, add, setQty, remove, clear, idempotencyKey, resetKey }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used inside CartProvider');
  return value;
}
