import { baseUrl, waitForHealthy } from './setup';
import { authHeaders } from './helpers/auth';
import {
  advance,
  cancelRaw,
  createProduct,
  getOrder,
  listMessages,
  placeOrder,
  postMessage,
  postMessageRaw,
  problemType,
  setStages,
} from './helpers/stages';
import { MESSAGE_RATE_LIMIT } from '../../src/threads/threads.controller';

// Its own tenant, so configuring messaging stages here cannot disturb any other
// suite's pipeline.
const TENANT = 'tenant_threads';

describe('order stage threads', () => {
  let admin: Record<string, string>;
  let buyer: Record<string, string>;

  beforeAll(async () => {
    await waitForHealthy();
    admin = await authHeaders(TENANT, 'thread-admin@example.com', 'admin');
    buyer = await authHeaders(TENANT, 'thread-buyer@example.com', 'buyer');
  });

  const shopWithTwoTalkingStages = () =>
    setStages(admin, [
      { name: 'Awaiting artwork', cancellable: true, messaging: true },
      { name: 'Mount cut', messaging: true },
      { name: 'Collected' },
    ]);

  it('stamps a message with the stage the order is in', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const message = await postMessage(buyer, order.id, 'Sending the print today');
    expect(message.stageId).toBe(order.currentStageId);
    expect(message.authorRole).toBe('buyer');
  });

  it('records the seller as the seller', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const message = await postMessage(admin, order.id, 'Received, thank you');
    expect(message.authorRole).toBe('seller');
  });

  it('lands a message in the new stage once the order advances, keeping the old thread as history', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const first = await postMessage(buyer, order.id, 'in stage one');
    await advance(admin, order.id, order.currentStageId);
    const second = await postMessage(buyer, order.id, 'in stage two');

    // There is no way to address the old stage: the server stamps the current
    // one, so a closed thread cannot be written to even by a client that wants to.
    expect(second.stageId).not.toBe(first.stageId);

    const all = await listMessages(buyer, order.id);
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.body).sort()).toEqual(['in stage one', 'in stage two']);
  });

  // A conversation reads top to bottom. The repository's default is newest
  // first, which is right for a listing and upside down for a thread.
  it('returns a thread oldest first', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    await postMessage(buyer, order.id, 'first');
    await postMessage(admin, order.id, 'second');
    await postMessage(buyer, order.id, 'third');

    const thread = await listMessages(buyer, order.id);
    expect(thread.map((m) => m.body)).toEqual(['first', 'second', 'third']);
  });

  it('refuses a message in a stage the shop left unmessageable', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    await advance(admin, order.id, order.currentStageId);
    const middle = await getOrder(buyer, order.id);
    await advance(admin, order.id, middle.currentStageId); // now at 'Collected'

    const res = await postMessageRaw(buyer, order.id, 'hello?');
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('stage-not-messageable');
  });

  it('refuses a message on a cancelled order', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);
    expect((await cancelRaw(buyer, order.id)).status).toBe(200);

    const res = await postMessageRaw(buyer, order.id, 'still there?');
    expect(res.status).toBe(409);
    expect(await problemType(res)).toContain('order-not-messageable');
  });

  it('rejects a blank message', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const res = await postMessageRaw(buyer, order.id, '   ');
    expect(res.status).toBe(400);
  });

  it('hides another buyer thread behind a 404', async () => {
    await shopWithTwoTalkingStages();
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(buyer, [{ productId: product.id, quantity: 1 }]);

    const mallory = await authHeaders(TENANT, 'thread-mallory@example.com', 'buyer');
    const read = await fetch(`${baseUrl}/api/v1/orders/${order.id}/messages`, {
      headers: mallory,
    });
    expect(read.status).toBe(404);

    const write = await postMessageRaw(mallory, order.id, 'let me in');
    expect(write.status).toBe(404);
  });

  // Last in the file on purpose: the burst leaves this route throttled for the
  // window, and any message test after it would fail for that reason instead of
  // its own. Its own buyer identity for the same reason.
  it('limits message posting more tightly than the default bucket', async () => {
    await shopWithTwoTalkingStages();
    const spammer = await authHeaders(TENANT, 'thread-spammer@example.com', 'buyer');
    const product = await createProduct(admin, { stock: 3 });
    const order = await placeOrder(spammer, [{ productId: product.id, quantity: 1 }]);

    const burst = await Promise.all(
      Array.from({ length: MESSAGE_RATE_LIMIT + 5 }, (_, i) =>
        postMessageRaw(spammer, order.id, `spam ${i}`),
      ),
    );

    const limited = burst.find((r) => r.status === 429);
    expect(limited).toBeDefined();
    // Refused in the shape the rest of the API answers in, not throttler's default text.
    expect(await problemType(limited!)).toContain('too-many-requests');
  });
});
