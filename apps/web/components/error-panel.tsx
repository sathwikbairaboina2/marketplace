'use client';

import { Button } from 'antd';
import { ExclamationCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { ContractMismatchError, ProblemError } from '../lib/api/http';

/**
 * What is left on screen after the toast fades.
 *
 * `notifyProblem` raises an ANTD notification for eight seconds and the page
 * then renders its empty state -- so a failed request ends up claiming
 * "Nothing here yet", which is not what happened. This says what happened and
 * offers the only useful response to it.
 *
 * The trace id is shown deliberately: both services' ProblemFilter puts one on
 * every response it writes, and it is the single thing that makes a failure a
 * user reports findable in the server logs.
 */
export function ErrorPanel({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, detail, traceId } = describe(error);

  return (
    <div className="mp-error" role="alert">
      <span className="mp-error-icon" aria-hidden="true">
        <ExclamationCircleOutlined />
      </span>
      <div className="mp-error-body">
        <div className="mp-error-title">{title}</div>
        {detail && <p className="mp-error-detail">{detail}</p>}
        {traceId && <code className="mp-error-trace">trace: {traceId}</code>}
      </div>
      {onRetry && (
        <Button icon={<ReloadOutlined />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function describe(error: unknown): {
  title: string;
  detail?: string;
  traceId?: string;
} {
  if (error instanceof ProblemError) {
    return { title: error.title, detail: error.detail, traceId: error.traceId };
  }
  if (error instanceof ContractMismatchError) {
    return {
      title: 'Contract mismatch',
      detail: `${error.message}. This console and the service disagree about the response shape, so the data cannot be shown safely.`,
    };
  }
  // A network failure lands here: fetch rejects before there is a status, so
  // there is no problem document to read and no trace id to quote.
  return {
    title: 'Could not reach the service',
    detail: error instanceof Error ? error.message : String(error),
  };
}
