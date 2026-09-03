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
    expect(((await res.json()) as { type: string }).type).toContain('invalid-request');
  });

  it('books repeatedly under the capacity-pinning condition without spuriously rejecting', async () => {
    // Task 14 fix round 1: the capacity claim's ConditionExpression now also pins
    // `#capacity = :capacity` (closing the read-then-write window on `capacity` itself, not
    // just `bookedCount`). That extra clause participates in *every* booking, so it must not
    // reject legitimate, non-contending requests -- two sequential bookings against an event
    // with headroom should both succeed and the counter should reflect both.
    const event = await createEvent(headers, 5);

    const first = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 2 }),
    });
    expect(first.status).toBe(201);

    const second = await fetch(`${baseUrl}/api/v1/bookings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ eventId: event.id, ticketQuantity: 2 }),
    });
    expect(second.status).toBe(201);

    const after = await fetch(`${baseUrl}/api/v1/events/${event.id}`, { headers });
    expect(after.status).toBe(200);
    expect(((await after.json()) as { bookedCount: number }).bookedCount).toBe(4);
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

    // Counting statuses alone would still pass if the nineteen losers failed for the wrong
    // reason (e.g. all reported as `transaction-conflict`, or `request-in-progress` if an
    // `Idempotency-Key` ever reached these shared headers). Pin down why they lost, so a
    // regression that preserves the 1/19 split for an unrelated reason doesn't slip through.
    const failedBodies = await Promise.all(
      responses.filter((r) => r.status === 409).map((r) => r.json() as Promise<{ type: string }>),
    );
    expect(failedBodies.some((b) => b.type.includes('event-at-capacity'))).toBe(true);

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
    const createdBooking = (await created.json()) as { id: string; userId: string };

    const res = await fetch(`${baseUrl}/api/v1/bookings?limit=5`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; userId: string }[] };
    // `body.items.length > 0` alone would still pass even if the booking just created never made
    // it into the page returned -- assert the specific booking is actually present, not merely
    // that the list is non-empty.
    expect(body.items.map((i) => i.id)).toContain(createdBooking.id);
    expect(body.items.every((i) => i.userId === createdBooking.userId)).toBe(true);
  });

  it('rejects an invalid limit query param', async () => {
    const res = await fetch(`${baseUrl}/api/v1/bookings?limit=abc`, { headers });
    expect(res.status).toBe(400);
  });

  it('hides another user booking within the same tenant', async () => {
    // A buyer, explicitly: an admin of the same tenant may read any booking in
    // it (the shop-wide list below), so the hiding rule is about other buyers.
    const otherHeaders = await authHeaders('tenant_a', 'dave@example.com', 'buyer');
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

    // Negative half: a different buyer in the *same* tenant cannot -- and gets 404, never 403,
    // so the error channel itself doesn't confirm the booking exists to someone who can't see it.
    const otherRes = await fetch(`${baseUrl}/api/v1/bookings/${id}`, { headers: otherHeaders });
    expect(otherRes.status).toBe(404);
  });

  // The seller's attendance list. The route crosses the per-user scoping the
  // plain list applies, so it is admin-gated, and a buyer is told so with a
  // 403 rather than handed an empty page that looks like "no bookings".
  describe('the shop-wide list', () => {
    let buyer: Record<string, string>;
    let otherBuyer: Record<string, string>;
    let bookingId: string;

    beforeAll(async () => {
      buyer = await authHeaders('tenant_a', 'booker@example.com', 'buyer');
      otherBuyer = await authHeaders('tenant_a', 'other-booker@example.com', 'buyer');
      const event = await createEvent(headers, 5);
      const created = await fetch(`${baseUrl}/api/v1/bookings`, {
        method: 'POST',
        headers: buyer,
        body: JSON.stringify({ eventId: event.id, ticketQuantity: 1 }),
      });
      expect(created.status).toBe(201);
      bookingId = ((await created.json()) as { id: string }).id;
    });

    it('shows an admin every booking in the shop, including a buyer\'s', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/all?limit=100`, { headers });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { id: string }[] };
      expect(body.items.map((b) => b.id)).toContain(bookingId);
    });

    it('refuses the shop-wide list to a buyer', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/all`, { headers: buyer });
      expect(res.status).toBe(403);
    });

    it('lets an admin open a booking another user made', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, { headers });
      expect(res.status).toBe(200);
    });

    it('still hides a booking from a buyer who did not make it', async () => {
      const res = await fetch(`${baseUrl}/api/v1/bookings/${bookingId}`, { headers: otherBuyer });
      expect(res.status).toBe(404);
    });
  });
});
