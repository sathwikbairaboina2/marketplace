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

  it('returns an empty list when CancellationReasons is not an array', () => {
    expect(failedTransactionIndexes({ CancellationReasons: 'nope' })).toEqual([]);
    expect(failedTransactionIndexes({ CancellationReasons: undefined })).toEqual([]);
    expect(failedTransactionIndexes({})).toEqual([]);
  });

  it('skips a null entry inside CancellationReasons without throwing', () => {
    const err = {
      CancellationReasons: [null, { Code: 'ConditionalCheckFailed' }, null],
    };
    expect(failedTransactionIndexes(err)).toEqual([1]);
  });

  it('returns an empty list when err is not an object', () => {
    expect(failedTransactionIndexes('boom')).toEqual([]);
    expect(failedTransactionIndexes(null)).toEqual([]);
    expect(failedTransactionIndexes(undefined)).toEqual([]);
  });
});
