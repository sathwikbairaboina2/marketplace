'use client';

import Link from 'next/link';
import type { EventResponse } from '@marketplace/contracts';
import { CalendarOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { placeholderFor } from '../lib/placeholder';
import { formatDateTime, formatPrice } from '../lib/format';

/** Under this many places left, the number is worth saying out loud. */
const NEARLY_FULL = 5;

/**
 * A class, as a card. The events list was an antd table: on a 390px phone the
 * price and any Book action sat off the right edge behind a horizontal scroll
 * with no affordance saying so, on the highest-margin line in the shop.
 *
 * It also published "22 of 24 places left", which is scarcity read backwards —
 * a shopper is told a class is empty. This says how full it is only when that
 * is a reason to hurry.
 */
export function EventCard({ event }: { event: EventResponse }) {
  const image = event.images[0];
  const { gradient, initials } = placeholderFor(event.id, event.title);
  const href = `/events/${event.id}`;
  const remaining = event.capacity - event.bookedCount;
  const soldOut = remaining < 1;

  return (
    <article className="mp-card" data-soldout={soldOut || undefined}>
      <Link href={href} className="mp-card-media" tabIndex={-1} aria-hidden="true">
        {image ? (
          // Plain img, not next/image: the optimiser needs a remotePatterns
          // allow-list that fails confusingly for user-supplied hosts.
          <img src={image} alt="" loading="lazy" />
        ) : (
          <span className="mp-card-placeholder" style={{ background: gradient }}>
            {initials}
          </span>
        )}
      </Link>

      <div className="mp-card-body">
        <span className="mp-card-cat">
          <CalendarOutlined /> {formatDateTime(event.startDate)}
        </span>

        <Link href={href} className="mp-card-name">
          {event.title}
        </Link>

        {event.location && (
          <span className="mp-card-cat">
            <EnvironmentOutlined /> {event.location}
          </span>
        )}

        <div className="mp-card-foot">
          <span className="mp-card-price">
            {event.basePriceMinor === 0
              ? 'Free'
              : formatPrice(event.basePriceMinor, event.currency)}
          </span>
          <span className="mp-card-stock" data-low={soldOut || remaining <= NEARLY_FULL}>
            {soldOut
              ? 'Fully booked'
              : remaining <= NEARLY_FULL
                ? `Only ${remaining} place${remaining === 1 ? '' : 's'} left`
                : 'Places available'}
          </span>
        </div>
      </div>
    </article>
  );
}
