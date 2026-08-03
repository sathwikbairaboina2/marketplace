import { conflictedTransactionIndexes, failedTransactionIndexes } from './transaction-errors';

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

describe('conflictedTransactionIndexes', () => {
  it('reports which transaction items were contended by another concurrent transaction', () => {
    const err = {
      name: 'TransactionCanceledException',
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'TransactionConflict' },
        { Code: 'None' },
        { Code: 'TransactionConflict' },
      ],
    };
    expect(conflictedTransactionIndexes(err)).toEqual([1, 3]);
  });

  it('does not report a ConditionalCheckFailed reason as a conflict', () => {
    const err = {
      CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
    };
    expect(conflictedTransactionIndexes(err)).toEqual([]);
  });

  it('distinguishes a mixture of ConditionalCheckFailed and TransactionConflict reasons', () => {
    const err = {
      CancellationReasons: [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'TransactionConflict' },
        { Code: 'None' },
      ],
    };
    expect(failedTransactionIndexes(err)).toEqual([0]);
    expect(conflictedTransactionIndexes(err)).toEqual([1]);
  });

  it('returns an empty list for an unrelated error', () => {
    expect(conflictedTransactionIndexes(new Error('boom'))).toEqual([]);
    expect(conflictedTransactionIndexes({ CancellationReasons: 'nope' })).toEqual([]);
    expect(conflictedTransactionIndexes('boom')).toEqual([]);
    expect(conflictedTransactionIndexes(null)).toEqual([]);
    expect(conflictedTransactionIndexes(undefined)).toEqual([]);
  });
});
