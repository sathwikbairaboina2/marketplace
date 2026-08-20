import { FakeCardProvider } from './fake-card.provider';

const card = (number: string) => ({ number, expMonth: 12, expYear: 2030, cvc: '123' });
const input = (number: string) => ({
  orderId: 'o-1',
  amountMinor: 2400,
  currency: 'USD',
  card: card(number),
});

describe('FakeCardProvider', () => {
  const provider = new FakeCardProvider();

  it('charges the success number and returns last4', async () => {
    const result = await provider.charge(input('4242424242424242'));
    expect(result.last4).toBe('4242');
    expect(result.paymentId).toMatch(/^fake_/);
  });

  it('declines 4000000000000002 with a payment-declined problem', async () => {
    await expect(provider.charge(input('4000000000000002'))).rejects.toMatchObject({
      problem: expect.objectContaining({
        type: expect.stringContaining('payment-declined'),
        status: 402,
      }),
    });
  });

  it('refuses 4000000000009995 with insufficient-funds', async () => {
    await expect(provider.charge(input('4000000000009995'))).rejects.toMatchObject({
      problem: expect.objectContaining({
        type: expect.stringContaining('insufficient-funds'),
        status: 402,
      }),
    });
  });

  it('succeeds for any other Luhn-valid number', async () => {
    await expect(provider.charge(input('4111111111111111'))).resolves.toMatchObject({
      last4: '1111',
    });
  });

  it('never includes the card number in the result', async () => {
    const result = await provider.charge(input('4242424242424242'));
    expect(JSON.stringify(result)).not.toContain('4242424242424242');
  });
});
