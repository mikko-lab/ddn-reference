// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import { errored, idle, loaded, nextPollTickState, type FetchState } from './fetch-state.js';

export interface UsePollingOptions<T> {
  readonly intervalMs: number;
  readonly enabled: boolean;
  /** Once true for the latest fetched data, polling stops (the interval
   * is cleared) -- but the hook keeps rendering the last loaded state. */
  readonly isTerminal?: (data: T) => boolean;
}

/** Polls `fetchFn` on a real interval and reports the current FetchState --
 * every value it ever reports came from an actual resolved fetch, never a
 * simulated/timed placeholder. Stops polling once `enabled` is false or
 * `isTerminal` returns true for the most recent successful fetch. */
export function usePolling<T>(fetchFn: () => Promise<T>, options: UsePollingOptions<T>): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>(idle());
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;
  const isTerminalRef = useRef(options.isTerminal);
  isTerminalRef.current = options.isTerminal;

  useEffect(() => {
    if (!options.enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function tick(): Promise<void> {
      setState((prev) => nextPollTickState(prev));
      try {
        const data = await fetchFnRef.current();
        if (cancelled) return;
        setState(loaded(data));
        if (isTerminalRef.current?.(data) && timer) {
          clearInterval(timer);
        }
      } catch (error) {
        if (cancelled) return;
        setState(errored(error instanceof Error ? error.message : String(error)));
      }
    }

    void tick();
    timer = setInterval(() => void tick(), options.intervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [options.enabled, options.intervalMs]);

  return state;
}
