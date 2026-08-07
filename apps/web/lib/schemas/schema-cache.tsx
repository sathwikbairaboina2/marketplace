'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { DynamicEntityType, SchemaView } from '@marketplace/contracts';
import { listSchemas } from '../api/schemas';
import { useAuth } from '../auth/auth-context';

type SchemaMap = Partial<Record<DynamicEntityType, SchemaView>>;

interface SchemaValue {
  schemas: SchemaMap | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SchemaContext = createContext<SchemaValue | null>(null);

export function SchemaProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
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
      const { items } = await listSchemas();
      setSchemas(Object.fromEntries(items.map((item) => [item.entityType, item])) as SchemaMap);
    } catch {
      // Left as-is: a stale cache is more useful than an empty one.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token) void refresh();
    else setSchemas(null);
  }, [token, refresh]);

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
