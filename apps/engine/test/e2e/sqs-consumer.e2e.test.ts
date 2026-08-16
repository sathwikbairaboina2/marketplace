import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';

const sqs = new SQSClient({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:4566',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

// A dedicated, per-run tenant keeps this suite's Flow-list mutations from
// interfering with other suites sharing the same table and stack (Task 15's
// flows suite follows the same pattern with `tenant_flows_<random>`).
const tenantId = `tenant_sqs_${Math.random().toString(36).slice(2, 8)}`;

type FlowSummary = { blueprintDiff: { addedFields: { name: string }[] }; proposedBy: string };

async function flowsFor(headers: Record<string, string>): Promise<{ items: FlowSummary[] }> {
  const res = await fetch(`${baseUrl}/api/v1/flows?limit=50`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: FlowSummary[] };
}

async function waitForFlow(headers: Record<string, string>, field: string, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = await flowsFor(headers);
    if (items.some((f) => f.blueprintDiff.addedFields.some((a) => a.name === field))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

describe('sqs consumer', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    headers = await authHeaders(tenantId, `sqs-${Date.now()}@example.com`);
  });

  it('creates a proposed flow from a PROPOSE_FLOW message', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageGroupId: `TENANT#${tenantId}`,
        MessageBody: JSON.stringify({
          action: 'PROPOSE_FLOW',
          targetEntity: 'Event',
          tenantId: `TENANT#${tenantId}`,
          payload: { addedFields: [{ name: field, type: 'string' }] },
          metadata: { threadId: 'thread_88291' },
        }),
      }),
    );

    expect(await waitForFlow(headers, field)).toBe(true);

    const { items } = await flowsFor(headers);
    const matching = items.filter((f) => f.blueprintDiff.addedFields.some((a) => a.name === field));
    expect(matching).toHaveLength(1);
    // The consumer runs `runWithTenant({ userId: 'system:agents', ... })` (see
    // `messaging/sqs-consumer.service.ts`) specifically so an AI-proposed Flow is attributed to
    // that system identity rather than the identity being silently discarded.
    expect(matching[0].proposedBy).toBe('system:agents');
  });

  it('does not auto-apply the schema change', async () => {
    const field = `field_${Math.random().toString(36).slice(2, 8)}`;
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.QUEUE_URL,
        MessageGroupId: `TENANT#${tenantId}`,
        MessageBody: JSON.stringify({
          action: 'PROPOSE_FLOW',
          targetEntity: 'Product',
          tenantId: `TENANT#${tenantId}`,
          payload: { addedFields: [{ name: field, type: 'string', required: true }] },
          metadata: { threadId: 'thread_2' },
        }),
      }),
    );
    expect(await waitForFlow(headers, field)).toBe(true);

    // The registry is untouched until a human executes the flow, so a product
    // that omits the proposed required field must still be accepted.
    const res = await fetch(`${baseUrl}/api/v1/products`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Chair',
        description: 'A chair',
        priceMinor: 1000,
        currency: 'INR',
        category: 'chairs',
        stock: 1,
      }),
    });
    expect(res.status).toBe(201);
  });
});
