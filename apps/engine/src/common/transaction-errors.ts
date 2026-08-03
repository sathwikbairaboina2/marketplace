interface CancellationReason {
  Code?: string;
}

function indexesWithCode(err: unknown, code: string): number[] {
  const reasons = (err as { CancellationReasons?: CancellationReason[] })?.CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.flatMap((r, i) => (r?.Code === code ? [i] : []));
}

export function failedTransactionIndexes(err: unknown): number[] {
  return indexesWithCode(err, 'ConditionalCheckFailed');
}

/**
 * Positions in a cancelled TransactWriteItems call whose item was contended by another
 * concurrent transaction (DynamoDB's `TransactionConflict` cancellation code), as distinct from
 * an item that failed its own ConditionExpression (`failedTransactionIndexes`,
 * `ConditionalCheckFailed`). A real table routinely produces `TransactionConflict` instead of
 * `ConditionalCheckFailed` when multiple transactions race on the same item -- DynamoDB Local's
 * concurrency model tends to produce only `ConditionalCheckFailed`, which is exactly why this
 * class of failure is easy to miss locally. Callers must treat a `TransactionConflict` as a
 * retryable conflict (409), not let the raw AWS error fall through to an unhandled 500.
 */
export function conflictedTransactionIndexes(err: unknown): number[] {
  return indexesWithCode(err, 'TransactionConflict');
}
