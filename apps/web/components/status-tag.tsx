'use client';

/**
 * Mapped explicitly rather than derived from the string.
 *
 * `cancelled` and `rejected` are both endings but only one is a failure;
 * `applied` and `confirmed` are both successes in different vocabularies. Any
 * heuristic over the word would eventually get one of those wrong, and these
 * particular values gate whether someone irreversibly mutates a tenant's data
 * model.
 */
const TONES: Record<string, string> = {
  // successes
  applied: 'success',
  confirmed: 'success',
  active: 'success',
  // in flight / awaiting a human
  proposed: 'pending',
  pending: 'pending',
  awaiting_payment: 'pending',
  // neutral lifecycle states
  draft: 'neutral',
  archived: 'neutral',
  out_of_stock: 'pending',
  // failures
  rejected: 'danger',
  cancelled: 'danger',
};

/**
 * Not ANTD's <Tag color="orange">. Its preset pairs a saturated pastel with a
 * near-white tint -- the `out of stock` badge measured 2.07:1, which axe flags
 * as serious and a reader in daylight simply cannot see. These four tones draw
 * their text from the status tokens and sit on the sunken surface, a pairing
 * that clears 4.5:1 in both themes.
 */
export function StatusTag({ status }: { status: string }) {
  // The text is always rendered, so colour is never the only carrier of
  // meaning -- required for a colour-blind reader, and it keeps the existing
  // e2e specs able to match on status text.
  // replaceAll, not replace: a string pattern replaces only the first match,
  // so `out_of_stock` rendered as "out of_stock".
  return (
    <span className="mp-tag" data-tone={TONES[status] ?? 'neutral'}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
