import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const tenantId = `tenant_schemas_${Math.random().toString(36).slice(2, 8)}`;

describe('schema registry reads', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders(tenantId, `schemas-${Date.now()}@example.com`);
  });

  it('returns an empty schema at version 0 for an unregistered entity', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`, { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entityType: 'Event', version: 0, fields: {} });
  });

  it('rejects an entity type that is not dynamic', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Flow`, { headers });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('lists every dynamic entity type', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas`, { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { entityType: string }[] };
    expect(body.items.map((i) => i.entityType).sort()).toEqual([
      'Booking',
      'Event',
      'Order',
      'Product',
    ]);
  });

  it('reflects a field added by an executed flow', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;

    const created = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Event',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const executed = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(executed.status).toBe(200);

    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`, { headers });
    const body = (await res.json()) as { version: number; fields: Record<string, { type: string }> };
    expect(body.version).toBe(1);
    expect(body.fields[field].type).toBe('string');
  });

  it('rejects an unauthenticated read', async () => {
    const res = await fetch(`${baseUrl}/api/v1/schemas/Event`);
    expect(res.status).toBe(401);
  });
});
