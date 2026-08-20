import { CardSchema, luhnValid, normalizeCardNumber, PaymentSchema, PayRequestSchema } from './payment';

describe('normalizeCardNumber', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeCardNumber('4242 4242-4242 4242')).toBe('4242424242424242');
  });
});

describe('luhnValid', () => {
  it('accepts the magic numbers', () => {
    expect(luhnValid('4242424242424242')).toBe(true);
    expect(luhnValid('4000000000000002')).toBe(true);
    expect(luhnValid('4000000000009995')).toBe(true);
  });
  it('rejects a digit-swapped number', () => {
    expect(luhnValid('4242424242424241')).toBe(false);
  });
});

describe('CardSchema', () => {
  const card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: 2030, cvc: '123' };

  it('accepts a well-formed card and normalizes the number', () => {
    expect(CardSchema.parse(card).number).toBe('4242424242424242');
  });
  it('rejects a Luhn-invalid number', () => {
    expect(CardSchema.safeParse({ ...card, number: '4242424242424241' }).success).toBe(false);
  });
  it('rejects an out-of-range month', () => {
    expect(CardSchema.safeParse({ ...card, expMonth: 13 }).success).toBe(false);
  });
  it('rejects a short cvc', () => {
    expect(CardSchema.safeParse({ ...card, cvc: '12' }).success).toBe(false);
  });
});

describe('PaymentSchema', () => {
  it('round-trips a stored payment (last4 only, never the number)', () => {
    const payment = { id: 'pay_1', last4: '4242', amountMinor: 2400, at: '2026-08-20T12:00:00.000Z' };
    expect(PaymentSchema.parse(payment)).toEqual(payment);
    expect('number' in PaymentSchema.shape).toBe(false);
  });
});

describe('PayRequestSchema', () => {
  it('is just a card envelope', () => {
    const parsed = PayRequestSchema.parse({
      card: { number: '4242424242424242', expMonth: 1, expYear: 2031, cvc: '999' },
    });
    expect(parsed.card.number).toBe('4242424242424242');
  });
});
