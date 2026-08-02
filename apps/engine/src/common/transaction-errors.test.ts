import { failedTransactionIndexes } from './transaction-errors';

describe('failedTransactionIndexes', () => {
  it('reports which transaction items failed their condition', () => {
    const err = {
      name: 'TransactionCanceledException',
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed' },
      ],
    };
    expect(failedTransactionIndexes(err)).toEqual([1, 3]);
  });

  it('returns an empty list for an unrelated error', () => {
    expect(failedTransactionIndexes(new Error('boom'))).toEqual([]);
  });
});
