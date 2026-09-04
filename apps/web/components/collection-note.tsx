'use client';

import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import type { ShopContact } from '@marketplace/contracts';
import { useShopReads } from '../lib/shop/reads';

/**
 * Where to come, when a buyer chooses to collect rather than have it posted.
 *
 * The address is the one the merchant already filled in under Settings for the
 * footer — asking her to type it a second time, in a second place, is how the
 * two end up disagreeing. A shop that has not filled it in still takes the
 * order: it says the studio will be in touch, which is true, rather than
 * inventing a place.
 */
export function CollectionNote() {
  const reads = useShopReads();
  const [contact, setContact] = useState<ShopContact | null>(null);

  useEffect(() => {
    let live = true;
    reads
      .getContact()
      .then((c) => {
        if (live) setContact(c);
      })
      .catch(() => {
        // No address is a quieter note, not an error.
      });
    return () => {
      live = false;
    };
  }, [reads]);

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 'var(--mp-space-5)' }}
      message={contact?.address ? 'Collect from' : 'Collecting'}
      description={
        contact?.address ? (
          <>
            {contact.address}
            {contact.phone ? ` · ${contact.phone}` : ''}
            <br />
            We will call you when it is ready.
          </>
        ) : (
          'The studio will be in touch to arrange a time.'
        )
      }
    />
  );
}
