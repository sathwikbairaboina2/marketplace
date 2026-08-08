'use client';

import Link from 'next/link';

/** Enough to tell two rows apart by eye; short enough not to lead the row. */
const SHORT = 6;

/**
 * A ULID or UUID rendered as what it is: a reference, not a name.
 *
 * Lists used to lead with the full 26-character id, which made the widest and
 * loudest thing in every row the one thing no human recognises. The rule this
 * component exists to hold is that an identifier is muted, monospace, short,
 * and never the first column -- and that the full value stays one hover or one
 * copy away, because support tickets are written in whole ids.
 */
export function Ref({ value, href }: { value: string; href?: string }) {
  const short = value.length > SHORT ? value.slice(-SHORT) : value;
  // `mp-id` already owns the monospace stack and `user-select: all`, so a
  // double-click selects the whole reference. `mp-ref` only mutes it.
  const body = (
    <code className="mp-id mp-ref" title={value}>
      {short}
    </code>
  );

  return href ? (
    <Link href={href} className="mp-ref-link">
      {body}
    </Link>
  ) : (
    body
  );
}
