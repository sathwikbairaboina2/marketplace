import { baseUrl } from '../setup';

/**
 * Helpers shared by the orders, pipeline and threads suites. Every one asserts
 * its own status before returning: an unguarded destructure of a failed call
 * hands back `undefined` and the test that follows fails -- or passes -- for the
 * wrong reason.
 */

export interface StageView {
  id: string;
  name: string;
  cancellable: boolean;
  messaging: boolean;
}

export interface OrderView {
  id: string;
  status: string;
  stages: StageView[];
  currentStageId: string;
  pipelineVersion: number;
  items: { productId: string; quantity: number }[];
}

export async function getPipeline(headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number; stages: StageView[] };
}

/** Saves the stage list, reading the current version first so callers need not track it. */
export async function setStages(
  admin: Record<string, string>,
  stages: Array<{ name: string; cancellable?: boolean; messaging?: boolean }>,
) {
  const { version } = await getPipeline(admin);
  const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
    method: 'PUT',
    headers: admin,
    body: JSON.stringify({
      version,
      stages: stages.map((stage) => ({
        name: stage.name,
        cancellable: stage.cancellable ?? false,
        messaging: stage.messaging ?? false,
      })),
    }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { version: number; stages: StageView[] };
}

export async function createProduct(
  admin: Record<string, string>,
  overrides: Record<string, unknown> = {},
) {
  const res = await fetch(`${baseUrl}/api/v1/products`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({
      name: 'Frame',
      description: 'A frame',
      priceMinor: 1000,
      currency: 'INR',
      category: 'frames',
      stock: 5,
      status: 'active',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

export async function stockOf(headers: Record<string, string>, productId: string): Promise<number> {
  const res = await fetch(`${baseUrl}/api/v1/products/${productId}`, { headers });
  expect(res.status).toBe(200);
  return ((await res.json()) as { stock: number }).stock;
}

export async function placeOrder(
  buyer: Record<string, string>,
  items: Array<{ productId: string; quantity: number }>,
): Promise<OrderView> {
  const res = await fetch(`${baseUrl}/api/v1/orders`, {
    method: 'POST',
    headers: buyer,
    body: JSON.stringify({ items, currency: 'INR', shippingAddress: { line1: '1 Road' } }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as OrderView;
}

export async function getOrder(
  headers: Record<string, string>,
  id: string,
): Promise<OrderView> {
  const res = await fetch(`${baseUrl}/api/v1/orders/${id}`, { headers });
  expect(res.status).toBe(200);
  return (await res.json()) as OrderView;
}

/** Raw, unasserted: callers assert the status themselves, including the 409 paths. */
export const advanceRaw = (
  admin: Record<string, string>,
  id: string,
  currentStageId: string,
): Promise<Response> =>
  fetch(`${baseUrl}/api/v1/orders/${id}/advance`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ currentStageId }),
  });

export async function advance(
  admin: Record<string, string>,
  id: string,
  currentStageId: string,
): Promise<OrderView> {
  const res = await advanceRaw(admin, id, currentStageId);
  expect(res.status).toBe(200);
  return (await res.json()) as OrderView;
}

export const cancelRaw = (headers: Record<string, string>, id: string): Promise<Response> =>
  fetch(`${baseUrl}/api/v1/orders/${id}/cancel`, { method: 'POST', headers });

export const problemType = async (res: Response): Promise<string> =>
  ((await res.json()) as { type: string }).type;
