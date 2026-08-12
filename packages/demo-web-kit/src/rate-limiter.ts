// SPDX-License-Identifier: Apache-2.0
// A simple in-memory, per-key sliding-window rate limiter for the demo
// BFF routes. Explicitly NOT a production rate-limiting solution: state
// lives in one process's memory, resets on restart, and isn't shared
// across instances -- adequate for the single local M7 demo process this
// BFF exists for. A factory (not a bare module-level singleton) so tests
// can exercise an isolated instance instead of shared global state.

export interface RateLimiterConfig {
  readonly windowMs: number;
  readonly maxRequestsPerWindow: number;
}

export interface RateLimiter {
  /** Returns true if the request is allowed (and records it), false if
   * `key` has already hit the limit within the current window. */
  check(key: string, now?: number): boolean;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const requestLog = new Map<string, number[]>();

  return {
    check(key: string, now: number = Date.now()): boolean {
      const recent = (requestLog.get(key) ?? []).filter((t) => now - t < config.windowMs);
      if (recent.length >= config.maxRequestsPerWindow) {
        requestLog.set(key, recent);
        return false;
      }
      recent.push(now);
      requestLog.set(key, recent);
      return true;
    },
  };
}
