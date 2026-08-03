import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const uniqueField = () => `field_${Math.random().toString(36).slice(2, 8)}`;

describe('flows', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    // A dedicated tenant keeps registry mutations from leaking into other suites.
    headers = await authHeaders(`tenant_flows_${Math.random().toString(36).slice(2, 8)}`, `flows-${Date.now()}@example.com`);
  });

  it('proposes a flow without applying it', async () => {
    const field = uniqueField();
    const res = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { status: string }).status).toBe('proposed');
  });

  it('rejects a destructive diff', async () => {
    const res = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: 'x', type: 'string' }], removedFields: ['price'] },
      }),
    });
    expect(res.status).toBe(400);
  });

  it('applies a flow, bumps the version and enforces the new field', async () => {
    const field = uniqueField();

    const proposed = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Product',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string', required: true }] },
      }),
    });
    // Guard the destructure below: if propose silently failed, `id` would be
    // `undefined`, execute would 404, and the rest of this invariant-5 chain
    // would fail for a reason unrelated to what it actually claims to prove.
    expect(proposed.status).toBe(201);
    const { id } = (await proposed.json()) as { id: string };

    const executed = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(executed.status).toBe(200);
    const flow = (await executed.json()) as { status: string; resultingVersion: number };
    expect(flow.status).toBe('applied');
    expect(flow.resultingVersion).toBeGreaterThan(0);

    const product = {
      name: 'Chair',
      description: 'A chair',
      priceMinor: 1000,
      currency: 'INR',
      category: 'chairs',
      stock: 1,
    };

    const missing = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify(product),
    });
    expect(missing.status).toBe(422);

    const provided = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...product, attributes: { [field]: 'vegan' } }),
    });
    expect(provided.status).toBe(201);
  });

  it('is idempotent on repeated execution', async () => {
    const field = uniqueField();
    const proposed = await fetch(`${baseUrl}/api/v1/flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetEntity: 'Event',
        actionType: 'ADD_FIELDS',
        blueprintDiff: { addedFields: [{ name: field, type: 'string' }] },
      }),
    });
    expect(proposed.status).toBe(201);
    const { id } = (await proposed.json()) as { id: string };

    const first = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(first.status).toBe(200);
    const second = await fetch(`${baseUrl}/api/v1/flows/${id}/execute`, { method: 'POST', headers });
    expect(second.status).toBe(200);

    expect(((await second.json()) as { resultingVersion: number }).resultingVersion).toBe(
      ((await first.json()) as { resultingVersion: number }).resultingVersion,
    );
  });
});
