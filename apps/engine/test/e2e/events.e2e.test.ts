import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const event = {
  title: 'Workshop',
  capacity: 25,
  startDate: '2026-09-01T09:00:00.000Z',
  endDate: '2026-09-01T17:00:00.000Z',
  basePriceMinor: 150000,
  currency: 'INR',
};

describe('events', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders('tenant_a', 'alice@example.com');
  });

  it('creates an event with a zero booked count', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; bookedCount: number; capacity: number };
    expect(body.bookedCount).toBe(0);
    expect(body.capacity).toBe(25);
  });

  it('rejects an event whose end precedes its start', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...event, endDate: '2026-08-01T09:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown event', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events/01J000000000000000000000AB`, { headers });
    expect(res.status).toBe(404);
  });

  it('lists events', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events?limit=5`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('lists events soonest-first regardless of creation order', async () => {
    // Its own tenant, so the fixed set of dates is the whole listing.
    const own = await authHeaders(`tenant_events_sort_${Date.now()}`, 'sorter@example.com');
    const dates = ['2026-12-01', '2026-09-15', '2026-10-20'];
    for (const day of dates) {
      const res = await fetch(`${baseUrl}/api/v1/events`, {
        method: 'POST',
        headers: own,
        body: JSON.stringify({
          ...event,
          title: `on ${day}`,
          startDate: `${day}T09:00:00.000Z`,
          endDate: `${day}T17:00:00.000Z`,
        }),
      });
      expect(res.status).toBe(201);
    }

    const list = await fetch(`${baseUrl}/api/v1/events?limit=25`, { headers: own });
    const body = (await list.json()) as { items: Array<{ startDate: string }> };
    const starts = body.items.map((e) => e.startDate);
    expect(starts).toEqual([...starts].sort());
    expect(starts[0]).toContain('2026-09-15');
  });

  it('does not expose one tenant event to another', async () => {
    const headersB = await authHeaders('tenant_b', 'bob-events@example.com');

    const created = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    // Guard the destructure: if creation didn't actually succeed, `id` would be `undefined`
    // and the cross-tenant lookup below would 404 for the wrong reason (no such SK exists at
    // all), proving nothing about isolation. Asserting 201 first keeps the isolation claim
    // meaningful.
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const ownTenant = await fetch(`${baseUrl}/api/v1/events/${id}`, { headers });
    expect(ownTenant.status).toBe(200);

    const crossTenant = await fetch(`${baseUrl}/api/v1/events/${id}`, { headers: headersB });
    expect(crossTenant.status).toBe(404);
  });

  it('does not expose internal PK/SK keys in responses', async () => {
    const created = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as Record<string, unknown>;
    expect(body.PK).toBeUndefined();
    expect(body.SK).toBeUndefined();
  });

  it('rejects a non-numeric limit', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events?limit=abc`, { headers });
    expect(res.status).toBe(400);
  });
});
