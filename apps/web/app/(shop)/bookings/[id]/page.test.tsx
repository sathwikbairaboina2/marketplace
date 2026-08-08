import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import BookingDetailPage from './page';

vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'bkg-1' }) }));

const getBooking = vi.fn();
const getEvent = vi.fn();
vi.mock('../../../../lib/api/bookings', () => ({ getBooking: (id: string) => getBooking(id) }));
vi.mock('../../../../lib/api/events', () => ({ getEvent: (id: string) => getEvent(id) }));
vi.mock('../../../../lib/schemas/schema-cache', () => ({ useSchema: () => null }));
vi.mock('../../../../lib/problem-notify', () => ({ notifyProblem: vi.fn() }));

const BOOKING = {
  entityType: 'Booking',
  id: '01KZERNSCDRB5DFVYVK11QEX9N',
  eventId: '01KZERNS77Z1E2HB509WV80MN6',
  userId: 'u1',
  status: 'confirmed',
  ticketQuantity: 1,
  createdAt: '2026-08-08T00:14:00.000Z',
  attributes: {},
};

beforeEach(() => {
  getBooking.mockReset();
  getEvent.mockReset();
  getBooking.mockResolvedValue(BOOKING);
});

describe('BookingDetailPage', () => {
  it('names the event it booked rather than showing its id', async () => {
    getEvent.mockResolvedValue({ id: BOOKING.eventId, title: 'Ergonomics Clinic' });

    render(<BookingDetailPage />);
    await act(async () => {});

    expect(screen.getByText('Ergonomics Clinic')).toBeInTheDocument();
    expect(screen.queryByText(BOOKING.eventId)).toBeNull();
  });

  it('falls back to a reference when the event cannot be fetched', async () => {
    getEvent.mockRejectedValue(new Error('gone'));

    render(<BookingDetailPage />);
    await act(async () => {});

    // A missing event title must not take the booking down with it.
    expect(screen.getByText('Booking')).toBeInTheDocument();
    expect(screen.getByTitle(BOOKING.eventId)).toBeInTheDocument();
  });
});
