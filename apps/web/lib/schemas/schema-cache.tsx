'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { DynamicEntityType, SchemaView } from '@marketplace/contracts';
import { listSchemas } from '../api/schemas';
import { publicListSchemas } from '../api/shop';
import { useAuth } from '../auth/auth-context';
import { useShop } from '../shop/shop-context';

type SchemaMap = Partial<Record<DynamicEntityType, SchemaView>>;

interface SchemaValue {
  schemas: SchemaMap | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SchemaContext = createContext<SchemaValue | null>(null);

export function SchemaProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const shop = useShop();
  const [schemas, setSchemas] = useState<SchemaMap | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * `GET /schemas` returns every dynamic entity type in one response, so this
   * is one call rather than four, and one eviction rather than four.
   *
   * Failures are swallowed on purpose: the pages that consume a schema already
   * render without one (a product form still shows its core fields), and a
   * thrown error here would take down whatever page happened to mount the
   * provider. `loading` must still clear, or every generated form spins forever.
   */
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = shop ? await publicListSchemas(shop.tenantId) : await listSchemas();
      setSchemas(Object.fromEntries(items.map((item) => [item.entityType, item])) as SchemaMap);
    } catch {
      // Left as-is: a stale cache is more useful than an empty one.
    } finally {
      setLoading(false);
    }
  }, [shop]);

  useEffect(() => {
    // A shop host needs no session to know its own fields; the platform host
    // still waits for one, because there the token is what names the tenant.
    if (shop === undefined) return;
    if (shop || token) void refresh();
    else setSchemas(null);
  }, [shop, token, refresh]);

  return (
    <SchemaContext.Provider value={{ schemas, loading, refresh }}>{children}</SchemaContext.Provider>
  );
}

export function useSchemas(): SchemaValue {
  const value = useContext(SchemaContext);
  if (!value) throw new Error('useSchemas must be used inside SchemaProvider');
  return value;
}

export function useSchema(entityType: DynamicEntityType): SchemaView | null {
  return useSchemas().schemas?.[entityType] ?? null;
}
