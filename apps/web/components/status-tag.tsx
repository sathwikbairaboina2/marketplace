'use client';

import { Tag } from 'antd';

/**
 * Mapped explicitly rather than derived from the string.
 *
 * `cancelled` and `rejected` are both endings but only one is a failure;
 * `applied` and `confirmed` are both successes in different vocabularies. Any
 * heuristic over the word would eventually get one of those wrong, and these
 * particular values gate whether someone irreversibly mutates a tenant's data
 * model.
 */
const COLOURS: Record<string, string> = {
  // successes
  applied: 'green',
  confirmed: 'green',
  active: 'green',
  // in flight / awaiting a human
  proposed: 'gold',
  pending: 'gold',
  // neutral lifecycle states
  draft: 'default',
  archived: 'default',
  out_of_stock: 'orange',
  // failures
  rejected: 'red',
  cancelled: 'red',
};

export function StatusTag({ status }: { status: string }) {
  // The text is always rendered, so colour is never the only carrier of
  // meaning -- required for a colour-blind reader, and it keeps the existing
  // e2e specs able to match on status text.
  return <Tag color={COLOURS[status] ?? 'default'}>{status.replace('_', ' ')}</Tag>;
}
