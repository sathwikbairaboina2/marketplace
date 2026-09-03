import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AdminBookingsPage from './page';

const listAllBookings = vi.fn();
vi.mock('../../../../lib/api/bookings', () => ({
  listAllBookings: (limit: number, cursor: string | null) => listAllBookings(limit, cursor),
}));
vi.mock('../../../../components/record-name', () => ({
  EventName: ({ id }: { id: string }) => <span>event:{id}</span>,
}));

const booking = (over: Record<string, unknown> = {}) => ({
  entityType: 'Booking',
  id: '01KZERNTAAAB5DFVYVK11QEX9N',
  eventId: '01KZERNS77Z1E2HB509WV80MN6',
  userId: 'someone-else',
  status: 'confirmed',
  ticketQuantity: 2,
  createdAt: '2026-08-16T12:00:00.000Z',
  attributes: {},
  ...over,
});

beforeEach(() => {
  listAllBookings.mockReset();
});

describe('AdminBookingsPage', () => {
  // The whole point of the page: it reads the shop-wide list, not the
  // signed-in admin's own bookings.
  it('lists every booking in the shop through the admin route', async () => {
    listAllBookings.mockResolvedValue({ items: [booking()], nextCursor: null });

    render(<AdminBookingsPage />);
    await act(async () => {});

    expect(listAllBookings).toHaveBeenCalledWith(25, null);
    expect(screen.getByText('event:01KZERNS77Z1E2HB509WV80MN6')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('offers the events page when there is nothing yet', async () => {
    listAllBookings.mockResolvedValue({ items: [], nextCursor: null });

    render(<AdminBookingsPage />);
    await act(async () => {});

    expect(screen.getByText('No bookings yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /your events/i })).toHaveAttribute('href', '/admin/events');
  });
});
