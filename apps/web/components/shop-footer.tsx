'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ShopContact } from '@marketplace/contracts';
import { useShop } from '../lib/shop/shop-context';
import { useShopReads } from '../lib/shop/reads';
import { useStorefrontConfig } from '../lib/storefront-config';

/**
 * The bottom of every shop page, which for 32 screenshots did not exist. A
 * stranger being asked for money by a shop they have never heard of had no way
 * to reach it — no address, no way to ask a question, nothing saying what
 * happens after they pay.
 *
 * What the merchant has not filled in is not invented: an empty field renders
 * as nothing, because a delivery promise the shop has not made is worse than
 * no line at all. The announcement bar has been promising "free shipping over
 * $50" on a shop whose engine has no concept of shipping cost.
 */
export function ShopFooter() {
  const shop = useShop();
  const reads = useShopReads();
  const config = useStorefrontConfig();
  const [contact, setContact] = useState<ShopContact | null>(null);

  useEffect(() => {
    if (!shop) return;
    let live = true;
    reads
      .getContact()
      .then((c) => {
        if (live) setContact(c);
      })
      .catch(() => {
        // A footer that cannot load its details is a quieter footer, not an
        // error: nothing above it depends on this.
      });
    return () => {
      live = false;
    };
  }, [reads, shop]);

  // The platform host is the cockpit's front door, not a shop.
  if (!shop) return null;

  const name = config?.businessProfile?.name ?? shop.tenantId;
  const whatsapp = contact?.whatsapp?.replace(/[^\d+]/g, '');

  return (
    <footer className="mp-shop-footer">
      <div className="mp-shop-footer-inner">
        <div className="mp-footer-col">
          <span className="mp-footer-name">{name}</span>
          {contact?.address && <p className="mp-footer-line">{contact.address}</p>}
          {contact?.phone && (
            <a className="mp-footer-line" href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`}>
              {contact.phone}
            </a>
          )}
          {contact?.email && (
            <a className="mp-footer-line" href={`mailto:${contact.email}`}>
              {contact.email}
            </a>
          )}
          {whatsapp && (
            <a
              className="mp-footer-line"
              href={`https://wa.me/${whatsapp.replace(/^\+/, '')}`}
              rel="noreferrer noopener"
              target="_blank"
            >
              Message on WhatsApp
            </a>
          )}
        </div>

        <nav className="mp-footer-col" aria-label="Shop">
          <span className="mp-footer-head">Shop</span>
          <Link href="/products">Everything</Link>
          <Link href="/events">Classes and events</Link>
          <Link href="/about">About</Link>
        </nav>

        <nav className="mp-footer-col" aria-label="Your order">
          <span className="mp-footer-head">Your order</span>
          <Link href="/orders">Find an order</Link>
          <Link href="/cart">Basket</Link>
        </nav>

        {(contact?.delivery || contact?.returns) && (
          <div className="mp-footer-col">
            <span className="mp-footer-head">Getting it to you</span>
            {contact.delivery && <p className="mp-footer-line">{contact.delivery}</p>}
            {contact.returns && <p className="mp-footer-line">{contact.returns}</p>}
          </div>
        )}
      </div>

      <p className="mp-footer-fine">
        © {new Date().getFullYear()} {name}
      </p>
    </footer>
  );
}
