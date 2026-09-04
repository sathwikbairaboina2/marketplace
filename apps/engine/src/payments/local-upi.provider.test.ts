import { createHmac } from 'node:crypto';
import { LocalUpiProvider, MAGIC_VPA } from './local-upi.provider';

const SECRET = 'local-webhook-secret-not-for-prod';
const provider = new LocalUpiProvider({ PAYMENT_WEBHOOK_SECRET: SECRET } as never);

const intentInput = {
  orderId: 'o1',
  tenantId: 'acme',
  reference: 'K7QY-3PX2',
  amountMinor: 420_000,
  currency: 'INR',
};

describe('verifying a webhook', () => {
  const body = JSON.stringify({ eventId: 'evt_1', intentId: 'upi_1', tenantId: 'acme' });
  const sign = (raw: string, secret = SECRET) =>
    createHmac('sha256', secret).update(raw).digest('hex');

  it('reads the event out of a correctly signed body', () => {
    expect(provider.verifyWebhook(body, sign(body))).toMatchObject({
      eventId: 'evt_1',
      tenantId: 'acme',
    });
  });

  // The one thing that must never pass. Each of these is a different way a
  // forged message could be presented.
  it('refuses a body signed with the wrong secret', () => {
    expect(provider.verifyWebhook(body, sign(body, 'not-the-secret'))).toBeNull();
  });

  it('refuses a body that was altered after signing', () => {
    const signature = sign(body);
    const tampered = JSON.stringify({ eventId: 'evt_1', intentId: 'upi_1', tenantId: 'other' });
    expect(provider.verifyWebhook(tampered, signature)).toBeNull();
  });

  it('refuses a message with no signature at all', () => {
    expect(provider.verifyWebhook(body, undefined)).toBeNull();
    expect(provider.verifyWebhook(body, '')).toBeNull();
  });

  it('refuses a signature of the wrong length rather than throwing', () => {
    expect(provider.verifyWebhook(body, 'ab')).toBeNull();
    expect(provider.verifyWebhook(body, 'not hex at all')).toBeNull();
  });

  it('refuses a correctly signed body that is not JSON', () => {
    expect(provider.verifyWebhook('nonsense', sign('nonsense'))).toBeNull();
  });
});

describe('starting an attempt', () => {
  it('round-trips the tenant, because the webhook arrives unauthenticated', async () => {
    const started = await provider.createIntent(intentInput);
    const event = await provider.getIntent(started.intentId);

    expect(event?.tenantId).toBe('acme');
    expect(event?.amountMinor).toBe(420_000);
  });

  it('answers pending and somewhere to approve, never a result', async () => {
    const started = await provider.createIntent(intentInput);

    expect(started.state).toBe('pending');
    expect(started.approvalUrl).toContain(started.intentId);
  });

  it('gives a declining customer a failed outcome', async () => {
    const started = await provider.createIntent({ ...intentInput, vpa: MAGIC_VPA.declined });

    expect((await provider.getIntent(started.intentId))?.state).toBe('failed');
  });

  // The only way to exercise the reconciliation poll: a payment that captures
  // and never sends a webhook, because there is nowhere to approve it from.
  it('offers no approval page for the silent handle, so only the poll can settle it', async () => {
    const started = await provider.createIntent({ ...intentInput, vpa: MAGIC_VPA.silent });

    expect(started.approvalUrl).toBeUndefined();
    expect((await provider.getIntent(started.intentId))?.state).toBe('paid');
  });

  it('knows nothing about an attempt it never started', async () => {
    expect(await provider.getIntent('upi_nope')).toBeNull();
  });
});
