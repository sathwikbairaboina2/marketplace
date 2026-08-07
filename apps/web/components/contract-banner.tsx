'use client';

import { useEffect, useState } from 'react';
import { Alert } from 'antd';
import type { ContractMismatchError } from '../lib/api/http';
import { onContractMismatch } from '../lib/problem-notify';

/**
 * A contract mismatch means this client and the service disagree about
 * @marketplace/contracts -- a build-level defect no user can retry past, so it
 * gets a persistent banner rather than a toast.
 *
 * A React error boundary would be the obvious mechanism and is the wrong one:
 * every one of these errors surfaces inside an async `.catch()`, and boundaries
 * only catch errors thrown during render. A subscription works from anywhere.
 */
export function ContractBanner() {
  const [error, setError] = useState<ContractMismatchError | null>(null);

  useEffect(() => onContractMismatch(setError), []);

  if (!error) return null;
  return (
    <Alert
      type="error"
      banner
      closable
      onClose={() => setError(null)}
      message="Client and server contracts disagree"
      description={`${error.message}. Rebuild @marketplace/contracts and both services.`}
    />
  );
}
