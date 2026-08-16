'use client';

import { useEffect, useState } from 'react';
import { getProduct } from '../lib/api/products';
import { getEvent } from '../lib/api/events';
import { Ref } from './ref';

/**
 * The name of a record a row refers to.
 *
 * Lists carried identifiers and nothing else: two orders placed the same
 * afternoon were indistinguishable without opening both. The payloads have no
 * names in them -- an order line holds the id its price was locked against --
 * so the name is fetched.
 *
 * Resolved per row and cached per id, because a list of orders repeats the
 * same handful of products constantly: without the cache one page of
 * twenty-five rows becomes twenty-five requests for the same mug. The cache is
 * module-level and lives as long as the tab, which is right for a name -- and
 * a name that changes mid-session shows the old one until the next load, which
 * is a fair trade for not hammering the engine on every render.
 */
const caches: Record<'product' | 'event', Map<string, Promise<string>>> = {
  product: new Map(),
  event: new Map(),
};

/** Test seam: a cache that outlived one test would decide the next one. */
export function __clearNameCache(): void {
  caches.product.clear();
  caches.event.clear();
}

function useName(kind: 'product' | 'event', id: string): string | null {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const cache = caches[kind];

    let pending = cache.get(id);
    if (!pending) {
      pending =
        kind === 'product'
          ? getProduct(id).then((p) => p.name)
          : getEvent(id).then((e) => e.title);
      cache.set(id, pending);
      // A failed lookup must not be cached as a permanent failure: the next
      // render should be free to try again.
      pending.catch(() => cache.delete(id));
    }

    pending
      .then((resolved) => {
        if (live) setName(resolved);
      })
      .catch(() => {
        // Deliberately quiet. A missing name degrades the row to its
        // reference; it is not worth a toast over a list that otherwise works.
      });

    return () => {
      live = false;
    };
  }, [kind, id]);

  return name;
}

interface Props {
  id: string;
  /** How many further items the row holds, if it holds more than one. */
  extra?: number;
  href?: string;
}

function Named({ kind, id, extra = 0, href }: Props & { kind: 'product' | 'event' }) {
  const name = useName(kind, id);

  return (
    <span className="mp-record-name">
      {name ? (
        href ? (
          <a href={href}>{name}</a>
        ) : (
          <span>{name}</span>
        )
      ) : (
        <Ref value={id} href={href} />
      )}
      {extra > 0 && <span className="mp-record-extra"> +{extra} more</span>}
    </span>
  );
}

export const ProductName = (props: Props) => <Named kind="product" {...props} />;
export const EventName = (props: Props) => <Named kind="event" {...props} />;
