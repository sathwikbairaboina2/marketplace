import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';
import {
  advance,
  advanceRaw,
  cancelRaw,
  createProduct,
  getOrder,
  placeOrder,
  problemType,
  setStages,
  stockOf,
} from './helpers/stages';

// Its own tenant: the pipeline is tenant-scoped, so configuring stages here must
// not change what the plain `orders` suite sees.
const TENANT = 'tenant_stages';

describe('advancing an order along its stages', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'stage-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'stage-buyer@example.com', 'buyer');
  });

  it('walks an order along the stages the owner defined', async () => {
    const pipeline = await setStages(admin, [
      { name: 'Mount cut', cancellable: true },
      { name: 'Glazed' },
    ]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    expect(order.currentStageId).toBe(pipeline.stages[0].id);
    const advanced = await advance(admin, order.id, order.currentStageId);
    expect(advanced.currentStageId).toBe(pipeline.stages[1].id);
  });

  it('refuses to advance past the last stage', async () => {
    await setStages(admin, [{ name: 'Only stage' }]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    // A shop that has never configured a pipeline has exactly one stage, which is
    // therefore also its last: there is nowhere to advance to, and that is
    // correct rather than a defect.
    const res = await advanceRaw(admin, order.id, order.currentStageId);
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('order-at-final-stage');
  });

  it('refuses an advance from a stage the order has already left', async () => {
    await setStages(admin, [{ name: 'First' }, { name: 'Second' }, { name: 'Third' }]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const stale = order.currentStageId;
    await advance(admin, order.id, stale);

    const res = await advanceRaw(admin, order.id, stale);
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('stage-moved');

    // And the order did not move twice.
    const after = await getOrder(buyer, order.id);
    expect(after.currentStageId).toBe(after.stages[1].id);
  });

  it('refuses an advance from a buyer', async () => {
    await setStages(admin, [{ name: 'One' }, { name: 'Two' }]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const res = await advanceRaw(buyer, order.id, order.currentStageId);
    expect(res.status).toBe(403);
  });

  it('records when the order entered its new stage', async () => {
    await setStages(admin, [{ name: 'Alpha' }, { name: 'Beta' }]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const advanced = await advance(admin, order.id, order.currentStageId);
    const entered = (advanced as unknown as { stageEnteredAt: string }).stageEnteredAt;
    const created = (order as unknown as { createdAt: string }).createdAt;
    expect(new Date(entered).getTime()).toBeGreaterThanOrEqual(new Date(created).getTime());
  });

  it('leaves an order in flight on the stages it was placed under', async () => {
    await setStages(admin, [{ name: 'Placed under this' }, { name: 'And this' }]);
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);
    const before = order.stages.map((s) => s.name);

    await setStages(admin, [{ name: 'Renamed entirely' }, { name: 'And again' }]);

    // The whole pinning decision, in one assertion.
    const after = await getOrder(buyer, order.id);
    expect(after.stages.map((s) => s.name)).toEqual(before);
    expect(after.pipelineVersion).toBe(order.pipelineVersion);
  });

  it('gives a shop that never configured one a single cancellable stage', async () => {
    const fresh = await authHeaders('tenant_unconfigured', 'nobody@example.com', 'buyer');
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, { headers: fresh });
    expect(res.status).toBe(200);
    const pipeline = (await res.json()) as {
      version: number;
      stages: { cancellable: boolean }[];
    };
    expect(pipeline.version).toBe(0);
    expect(pipeline.stages).toHaveLength(1);
    expect(pipeline.stages[0].cancellable).toBe(true);
  });

  it('refuses a pipeline save from a buyer', async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: buyer,
      body: JSON.stringify({ version: 0, stages: [{ name: 'Mine' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses a pipeline save from a stale version', async () => {
    await setStages(admin, [{ name: 'Current' }]);
    const res = await fetch(`${baseUrl}/api/v1/settings/pipeline`, {
      method: 'PUT',
      headers: admin,
      // Version 0 is only ever right for a shop that has never saved; this tenant has.
      body: JSON.stringify({ version: 0, stages: [{ name: 'Late' }] }),
    });
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('pipeline-version-conflict');
  });
});

describe('cancelling an order', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'stage-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'stage-buyer@example.com', 'buyer');
  });

  it('restores stock for every line item', async () => {
    await setStages(admin, [{ name: 'On the bench', cancellable: true }, { name: 'Gone' }]);
    const a = await createProduct(admin, { stock: 5 });
    const b = await createProduct(admin, { stock: 9 });
    const order = await placeOrder(buyer, [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 3 },
    ]);
    expect(await stockOf(admin, a.id)).toBe(3);

    const res = await cancelRaw(buyer, order.id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('cancelled');

    expect(await stockOf(admin, a.id)).toBe(5);
    expect(await stockOf(admin, b.id)).toBe(9);
  });

  it('refuses a second cancel and leaves stock alone', async () => {
    await setStages(admin, [{ name: 'Cancellable here', cancellable: true }]);
    const product = await createProduct(admin, { stock: 4 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);
    expect((await cancelRaw(buyer, order.id)).status).toBe(200);

    const res = await cancelRaw(buyer, order.id);
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('order-not-cancellable');
    expect(await stockOf(admin, product.id)).toBe(4);
  });

  it('refuses a cancel once the order reaches a stage the owner did not mark cancellable', async () => {
    await setStages(admin, [{ name: 'Packing', cancellable: true }, { name: 'Dispatched' }]);
    const product = await createProduct(admin, { stock: 4 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);
    await advance(admin, order.id, order.currentStageId);

    const res = await cancelRaw(buyer, order.id);
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('order-not-cancellable');
    // The stock stayed out, which is the entire point: those goods have gone.
    expect(await stockOf(admin, product.id)).toBe(3);
  });

  it('hides another buyer order behind a 404', async () => {
    await setStages(admin, [{ name: 'Cancellable', cancellable: true }]);
    const product = await createProduct(admin, { stock: 4 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const mallory = await authHeaders(TENANT, 'stage-mallory@example.com', 'buyer');
    const res = await cancelRaw(mallory, order.id);
    expect(res.status).toBe(404);
    expect(await stockOf(admin, product.id)).toBe(3);
  });

  it('restores stock exactly once when two cancels race', async () => {
    await setStages(admin, [{ name: 'Cancellable', cancellable: true }]);
    const product = await createProduct(admin, { stock: 6 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 2 }]);

    const [one, two] = await Promise.all([cancelRaw(buyer, order.id), cancelRaw(buyer, order.id)]);

    // Asserted on the resulting stock, not on the error class: orders.service.ts
    // documents that DynamoDB Local surfaces ConditionalCheckFailed where a real
    // table gives TransactionConflict, so the code is not stable across
    // environments but the invariant is.
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect(await stockOf(admin, product.id)).toBe(6);
  });

  it('has exactly one winner when a cancel races the seller advancing', async () => {
    // Stage one is cancellable, stage two is not: whoever loses this race must
    // lose completely. If both applied, the buyer would have cancelled goods
    // already dispatched and the stock would come back for items that left.
    await setStages(admin, [{ name: 'On the bench', cancellable: true }, { name: 'Dispatched' }]);
    const product = await createProduct(admin, { stock: 6 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 2 }]);

    const [cancelled, advanced] = await Promise.all([
      cancelRaw(buyer, order.id),
      advanceRaw(admin, order.id, order.currentStageId),
    ]);

    const final = await getOrder(buyer, order.id);
    if (cancelled.status === 200) {
      expect(advanced.status).toBe(409);
      expect(final.status).toBe('cancelled');
      // Stopped where it died, so the tracker can say where rather than only that.
      expect(final.currentStageId).toBe(order.currentStageId);
      expect(await stockOf(admin, product.id)).toBe(6);
    } else {
      expect(advanced.status).toBe(200);
      expect(final.status).toBe('confirmed');
      expect(final.currentStageId).not.toBe(order.currentStageId);
      expect(await stockOf(admin, product.id)).toBe(4);
    }
  });
});
