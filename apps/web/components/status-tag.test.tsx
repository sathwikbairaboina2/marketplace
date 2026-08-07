import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusTag } from './status-tag';

const ALL = [
  'proposed',
  'applied',
  'rejected',
  'pending',
  'confirmed',
  'cancelled',
  'active',
  'draft',
  'archived',
  'out_of_stock',
];

describe('StatusTag', () => {
  it('renders readable text for every known status', () => {
    for (const status of ALL) {
      const { unmount } = render(<StatusTag status={status} />);
      // Colour is never the only carrier. A colour-blind viewer has to tell
      // `proposed` from `applied`, and those two gate whether a tenant's data
      // model gets irreversibly mutated.
      expect(screen.getByText(status.replaceAll('_', ' '))).toBeInTheDocument();
      unmount();
    }
  });

  it('distinguishes a success from a terminal failure', () => {
    const { container: applied } = render(<StatusTag status="applied" />);
    const { container: rejected } = render(<StatusTag status="rejected" />);
    expect(applied.querySelector('.ant-tag')?.className).not.toBe(
      rejected.querySelector('.ant-tag')?.className,
    );
  });

  // `cancelled` and `rejected` are both endings but only one is a failure, and
  // `confirmed` and `applied` are both successes in different vocabularies.
  // Guessing from the string would eventually get one of these wrong.
  it('treats cancelled as a failure and confirmed as a success', () => {
    const { container: cancelled } = render(<StatusTag status="cancelled" />);
    const { container: confirmed } = render(<StatusTag status="confirmed" />);
    expect(cancelled.querySelector('.ant-tag')?.className).not.toBe(
      confirmed.querySelector('.ant-tag')?.className,
    );
  });

  it('falls back to a neutral tag for an unrecognised status', () => {
    render(<StatusTag status="something-new" />);
    expect(screen.getByText('something-new')).toBeInTheDocument();
  });
});
