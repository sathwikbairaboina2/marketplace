import { describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { FilterRail } from './filter-rail';

/**
 * ANTD's `Grid.useBreakpoint` reports every breakpoint false under jsdom, so
 * the rail renders its narrow variant: a trigger with the form behind a closed
 * drawer. Opening it puts the same `RailForm` on screen as the desktop aside.
 */
async function openRail() {
  const trigger = screen.queryByRole('button', { name: /filters/i });
  if (trigger) {
    await act(async () => {
      fireEvent.click(trigger);
    });
  }
}

describe('FilterRail', () => {
  it('submits major units as minor units', async () => {
    const onApply = vi.fn();
    render(<FilterRail fields={null} onApply={onApply} onClear={vi.fn()} />);
    await openRail();

    const min = screen.getByLabelText('Min price');
    await act(async () => {
      fireEvent.change(min, { target: { value: '899' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Search').closest('button')!);
    });

    // 899 means 899 pounds, not 899 pence. The old control meant the second.
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ priceMinorMin: 89900 }));
  });

  it('converts a value that arrives as a string', async () => {
    const onApply = vi.fn();
    render(<FilterRail fields={null} onApply={onApply} onClear={vi.fn()} />);
    await openRail();

    // ANTD hands back a number from the spinner but the raw string from typing,
    // and a `typeof === 'number'` guard dropped the filter without saying so.
    const max = screen.getByLabelText('Max price');
    await act(async () => {
      fireEvent.change(max, { target: { value: '12.5' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Search').closest('button')!);
    });

    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ priceMinorMax: 1250 }));
  });

  it('omits a price that was left blank rather than sending zero', async () => {
    const onApply = vi.fn();
    render(<FilterRail fields={null} onApply={onApply} onClear={vi.fn()} />);
    await openRail();

    await act(async () => {
      fireEvent.click(screen.getByText('Search').closest('button')!);
    });

    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ priceMinorMin: undefined, priceMinorMax: undefined }),
    );
  });
});
