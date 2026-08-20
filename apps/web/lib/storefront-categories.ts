'use client';

import { useEffect, useState } from 'react';
import { getPublishedStorefront } from './api/storefront';

/**
 * The categories the owner settled on during onboarding, as suggestions for
 * the product form.
 *
 * Read from the *published* storefront, not the draft: a category the shop
 * has not gone live with is not yet the shop's vocabulary. Suggestions only --
 * the field stays free text, so a category typed here that the list has never
 * heard of is still accepted.
 *
 * A failure is silent by design. Losing the suggestions costs the seller a
 * dropdown; a notification about it would interrupt a form they can still
 * complete perfectly well by typing.
 */
export function useStorefrontCategories(): string[] {
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    getPublishedStorefront()
      .then((config) => {
        if (live) setCategories(config?.categories ?? []);
      })
      .catch(() => {
        if (live) setCategories([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return categories;
}
