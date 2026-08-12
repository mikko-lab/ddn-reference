// SPDX-License-Identifier: Apache-2.0
// A small, generic "what state is this fetch in" union used by every
// decision-detail/validator-status view -- makes "still loading" vs
// "genuinely errored" vs "loaded" an explicit, renderable state instead of
// undefined/null ambiguity. Never represents progress that hasn't
// actually happened: 'loading' means a real fetch is in flight right now.

export type FetchState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'loaded'; readonly data: T };

export function idle<T>(): FetchState<T> {
  return { status: 'idle' };
}

export function loading<T>(): FetchState<T> {
  return { status: 'loading' };
}

export function errored<T>(message: string): FetchState<T> {
  return { status: 'error', message };
}

export function loaded<T>(data: T): FetchState<T> {
  return { status: 'loaded', data };
}

/** What a poll tick should render while its fetch is in flight. Only the
 * very first fetch (from 'idle') shows a loading state -- once a poll has
 * ever loaded or errored, a background retry keeps rendering that same
 * last-known state rather than flipping back to 'loading'. Without this,
 * a repeatedly-failing poll would unmount and remount its role="alert"
 * element every interval tick; screen readers announce a newly-mounted
 * alert on each occurrence, which turns a stalled poll into a disruptive,
 * unbounded flood of identical announcements instead of one alert that
 * simply persists until the fetch recovers. */
export function nextPollTickState<T>(prev: FetchState<T>): FetchState<T> {
  return prev.status === 'idle' ? loading() : prev;
}
