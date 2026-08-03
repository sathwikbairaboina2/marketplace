import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

async function createEvent(headers: Record<string, string>, capacity: number): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/v1/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Workshop',
      capacity,
      startDate: '2026-09-01T09:00:00.000Z',
      endDate: '2026-09-01T17:00:00.000Z',
      basePriceMinor: 150000,
      currency: 'INR',
    }),
  });
  // If event creation silently failed, an unguarded destructure here would hand back
  // `undefined` and every booking test below would fail (or the oversell test would "pass")
  // for the wrong reason -- see the standing instruction on guarding destructures.
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

describe('bookings', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('books tickets and increments the event booked count', async () => {
    const event = await createEvent(headers, 10);
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 3 }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe('confirmed');

    const after = await fetch(`${baseUrl}/api/v1/events/${event.id}`, { headers });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { bookedCount: number }).bookedCount).toBe(3);
  });

  it('rejects a booking beyond capacity', async () => {
    const event = await createEvent(headers, 2);
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 3 }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { type: string }).type).toContain('event-at-capacity');
  });

  it('returns 422 for an unknown event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: '01J000000000000000000000AB', ticketQuantity: 1 }),
    });
    expect(res.status).toBe(422);
  });

  it('never oversells under concurrency', async () => {
    const event = await createEvent(headers, 1);
    const body = JSON.stringify({ eventId: event.id, ticketQuantity: 1 });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${baseUrl}/api/v1/bookings`, { method: 'POST', headers, body }),
      ),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);

    const after = await fetch(`${baseUrl}/api/v1/events/${event.id}`, { headers });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { bookedCount: number }).bookedCount).toBe(1);
  });

  it('lists the caller own bookings', async () => {
    const event = await createEvent(headers, 5);
    const created = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 1 }),
    });
    expect(created.status).toBe(201);
    const createdBooking = (await created.json()) as { userId: string };

    const res = await fetch(`${baseUrl}/api/v1/bookings?limit=5`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { userId: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.userId === createdBooking.userId)).toBe(true);
  });

  it('rejects an invalid limit query param', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings?limit=abc`, { headers });
    expect(res.status).toBe(400);
  });

  it('hides another user booking within the same tenant', async () => {
    const otherHeaders = await authHeaders('tenant_a', 'dave@example.com');
    const event = await createEvent(headers, 5);
    const created = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 1 }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    // Positive half: the owning user can read their own booking.
    const ownerRes = await fetch(`${baseUrl}/api/v1/bookings/${id}`, { headers });
    expect(ownerRes.status).toBe(200);

    // Negative half: a different user in the *same* tenant cannot -- and gets 404, never 403,
    // so the error channel itself doesn't confirm the booking exists to someone who can't see it.
    const otherRes = await fetch(`${baseUrl}/api/v1/bookings/${id}`, { headers: otherHeaders });
    expect(otherRes.status).toBe(404);
  });
});
