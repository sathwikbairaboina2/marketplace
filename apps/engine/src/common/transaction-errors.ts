interface CancellationReason {
  Code?: string;
}

export function failedTransactionIndexes(err: unknown): number[] {
  const reasons = (err as { CancellationReasons?: CancellationReason[] })?.CancellationReasons;
  if (!Array.isArray(reasons)) return [];
  return reasons.flatMap((r, i) => (r?.Code === 'ConditionalCheckFailed' ? [i] : []));
}
