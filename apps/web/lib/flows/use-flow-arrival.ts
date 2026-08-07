'use client';

import { useEffect, useRef, useState } from 'react';
import { listFlows } from '../api/flows';

const INTERVAL_MS = 2000;
const LIMIT_MS = 30_000;

/**
 * Confirming a proposal in chat does not create a Flow -- it puts a
 * PROPOSE_FLOW message on SQS, and the engine's consumer creates the record
 * whenever it gets to it. The socket tells the client nothing when that
 * happens, so polling or a manual refresh are the only honest options.
 *
 * Timing out is not an error: nothing is broken at 30 seconds, the queue is
 * just slow. The caller shows "not here yet -- refresh", never a failure.
 */
export function useFlowArrival(active: boolean) {
  const [waiting, setWaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const baseline = useRef<string | null>(null);
  // Tracked separately from `baseline` because `null` is a legitimate baseline:
  // a tenant with no flows yet polls an empty list first, and treating that
  // absence as "not captured" would make the very flow we are waiting for look
  // like the starting state and never resolve.
  const hasBaseline = useRef(false);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();

    hasBaseline.current = false;
    baseline.current = null;
    setWaiting(true);
    setTimedOut(false);

    const tick = async () => {
      if (cancelled) return;

      try {
        const { items } = await listFlows(1, null);
        const newest = items[0]?.id ?? null;

        if (!hasBaseline.current) {
          baseline.current = newest;
          hasBaseline.current = true;
        } else if (newest !== baseline.current) {
          baseline.current = newest;
          if (!cancelled) {
            setWaiting(false);
            setReloadToken((n) => n + 1);
          }
          return;
        }
      } catch {
        // A transient failure mid-poll is not worth surfacing: the next tick or
        // the timeout resolves it either way.
      }

      if (cancelled) return;
      if (Date.now() - startedAt >= LIMIT_MS) {
        setWaiting(false);
        setTimedOut(true);
        return;
      }
      timer = setTimeout(() => void tick(), INTERVAL_MS);
    };

    timer = setTimeout(() => void tick(), INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active]);

  return { waiting, timedOut, reloadToken };
}
