import { MAX_MINOR_AMOUNT, MAX_QUANTITY, MinorAmountSchema, QuantitySchema, StockSchema } from './common';
import { MAX_ORDER_LINE_ITEMS } from './order';

describe('money and quantity bounds', () => {
  it('MinorAmountSchema accepts the bound and rejects one above it', () => {
    expect(MinorAmountSchema.parse(MAX_MINOR_AMOUNT)).toBe(MAX_MINOR_AMOUNT);
    expect(() => MinorAmountSchema.parse(MAX_MINOR_AMOUNT + 1)).toThrow();
  });

  it('QuantitySchema accepts the bound and rejects one above it', () => {
    expect(QuantitySchema.parse(MAX_QUANTITY)).toBe(MAX_QUANTITY);
    expect(() => QuantitySchema.parse(MAX_QUANTITY + 1)).toThrow();
  });

  it('StockSchema accepts the bound and rejects one above it', () => {
    expect(StockSchema.parse(MAX_QUANTITY)).toBe(MAX_QUANTITY);
    expect(() => StockSchema.parse(MAX_QUANTITY + 1)).toThrow();
  });

  it('the worst-case order total cannot leave Number.MAX_SAFE_INTEGER range', () => {
    // MAX_ORDER_LINE_ITEMS line items, each at the maximum unit price times the maximum
    // quantity -- the exact worst case OrdersService.create sums with plain `+`/`*`.
    const worstCaseTotal = MAX_MINOR_AMOUNT * MAX_QUANTITY * MAX_ORDER_LINE_ITEMS;
    expect(Number.isSafeInteger(worstCaseTotal)).toBe(true);
    expect(worstCaseTotal).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
});
