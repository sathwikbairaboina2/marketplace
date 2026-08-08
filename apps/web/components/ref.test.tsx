import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Ref } from './ref';

describe('Ref', () => {
  it('shows the last six characters and keeps the whole value in the title', () => {
    render(<Ref value="01KZERNSB5VDM40BYKWA48W631" />);

    const el = screen.getByText('48W631');
    expect(el).toBeInTheDocument();
    // The full id has to stay reachable: it is what someone pastes into a
    // support ticket or a DynamoDB query.
    expect(el).toHaveAttribute('title', '01KZERNSB5VDM40BYKWA48W631');
  });

  it('renders a short value whole rather than padding or truncating it', () => {
    render(<Ref value="abc" />);
    expect(screen.getByText('abc')).toBeInTheDocument();
  });

  it('wraps in a link when given an href', () => {
    render(<Ref value="01KZERNSB5VDM40BYKWA48W631" href="/orders/01KZERNSB5VDM40BYKWA48W631" />);

    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      '/orders/01KZERNSB5VDM40BYKWA48W631',
    );
    expect(screen.getByText('48W631')).toBeInTheDocument();
  });
});
