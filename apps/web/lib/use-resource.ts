'use client';

import { useCallback, useEffect, useState } from 'react';
import { notifyProblem } from './problem-notify';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  retry: () => void;
}

/**
 * One fetch, three states, in one place.
 *
 * Every page hand-rolled its own `useState` pair and its own `.catch`, which is
 * why the states drifted: some rendered a skeleton and some did not, none
 * rendered an error, and a failure left whatever the previous state happened to
 * be. A page that consumes this cannot forget a state it never wrote.
 *
 * `load` is called with an AbortSignal and its result is discarded if the
 * effect has been torn down, so a slow response for product A cannot land in
 * the page after the user has navigated to product B.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // The caller passes a fresh closure every render, so `load` itself cannot be
  // the dependency -- it would refetch on every render. The caller's declared
  // deps are the contract, exactly as with useEffect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    const controller = new AbortController();
    let live = true;

    setLoading(true);
    setError(null);

    run(controller.signal)
      .then((result) => {
        if (!live) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!live || controller.signal.aborted) return;
        setError(err);
        // The toast still fires: it is what tells someone already looking
        // elsewhere on the page that something failed. ErrorPanel is what
        // remains once it has gone.
        notifyProblem(err);
      })
      .finally(() => {
        if (live) setLoading(false);
      });

    return () => {
      live = false;
      controller.abort();
    };
  }, [run, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, error, loading, retry };
}
