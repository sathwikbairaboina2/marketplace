import { DEFAULT_DEPOSIT_POLICY, depositSplit, type DepositPolicy } from './settings';

const policy = (over: Partial<DepositPolicy> = {}): DepositPolicy => ({
  ...DEFAULT_DEPOSIT_POLICY,
  enabled: true,
  ...over,
});

describe('depositSplit', () => {
  it('takes nothing up front when the shop offers no deposit', () => {
    expect(depositSplit(1_200_000, policy({ enabled: false }))).toEqual({
      payNowMinor: 1_200_000,
      balanceDueMinor: 0,
    });
  });

  it('leaves small orders alone, so a mug is not sold on terms', () => {
    expect(depositSplit(95_000, policy({ minOrderMinor: 500_000 }))).toEqual({
      payNowMinor: 95_000,
      balanceDueMinor: 0,
    });
  });

  it('splits an even total down the middle', () => {
    expect(depositSplit(1_200_000, policy())).toEqual({
      payNowMinor: 600_000,
      balanceDueMinor: 600_000,
    });
  });

  it('gives the buyer the larger half of an odd total', () => {
    // The one who is owed money should not also be owed a paisa: the amount
    // collected in the room is the rounder number.
    const split = depositSplit(1_234_567, policy());
    expect(split.payNowMinor).toBe(617_284);
    expect(split.balanceDueMinor).toBe(617_283);
    expect(split.payNowMinor).toBeGreaterThan(split.balanceDueMinor);
  });

  it('always sums back to the total, at every percentage', () => {
    for (const percent of [10, 25, 33, 50, 67, 90]) {
      for (const total of [500_000, 999_999, 1_234_567, 7_777_777]) {
        const split = depositSplit(total, policy({ percent }));
        expect(split.payNowMinor + split.balanceDueMinor).toBe(total);
        expect(Number.isInteger(split.payNowMinor)).toBe(true);
        expect(Number.isInteger(split.balanceDueMinor)).toBe(true);
      }
    }
  });

  it('never asks for more up front than the order is worth', () => {
    const split = depositSplit(500_000, policy({ percent: 90 }));
    expect(split.payNowMinor).toBeLessThanOrEqual(500_000);
    expect(split.balanceDueMinor).toBeGreaterThanOrEqual(0);
  });
});
