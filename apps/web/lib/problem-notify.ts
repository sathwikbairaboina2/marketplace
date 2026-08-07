import { notification } from 'antd';
import { ContractMismatchError, ProblemError } from './api/http';

let mismatchHandler: ((err: ContractMismatchError) => void) | null = null;

/** Subscribe the banner. Returns an unsubscribe function, for useEffect. */
export function onContractMismatch(handler: (err: ContractMismatchError) => void): () => void {
  mismatchHandler = handler;
  return () => {
    mismatchHandler = null;
  };
}

/**
 * A ProblemError always carries a traceId -- both services' ProblemFilter adds
 * one to every response it writes. Showing it is what makes a failure a user
 * reports traceable in the server logs.
 */
export function notifyProblem(err: unknown): void {
  if (err instanceof ProblemError) {
    notification.error({
      message: err.title,
      description: [err.detail, err.traceId && `trace: ${err.traceId}`].filter(Boolean).join(' · '),
      duration: 8,
    });
    return;
  }

  // A contract mismatch goes to the banner, not to a toast that disappears.
  // Routing it through a subscription rather than re-throwing matters: every
  // caller of this function is an async `.catch()`, and a re-throw from there
  // is an unhandled rejection that no React error boundary would ever see.
  if (err instanceof ContractMismatchError) {
    if (mismatchHandler) mismatchHandler(err);
    else notification.error({ message: 'Contract mismatch', description: err.message });
    return;
  }

  notification.error({ message: 'Unexpected error', description: String(err) });
}

/**
 * Maps a 400's `errors[]` onto ANTD form fields where the names line up, for
 * the caller to hand to `form.setFields`.
 */
export function toFormErrors(err: unknown): { name: string; errors: string[] }[] {
  if (!(err instanceof ProblemError)) return [];
  return err.errors
    .filter((e) => typeof e.path === 'string' && e.path.length > 0)
    .map((e) => ({ name: e.path, errors: [e.message] }));
}
