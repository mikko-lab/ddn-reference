// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errored, idle, loaded, loading, nextPollTickState } from './fetch-state.js';

test('idle/loading/error/loaded produce the expected discriminated shapes', () => {
  assert.deepEqual(idle(), { status: 'idle' });
  assert.deepEqual(loading(), { status: 'loading' });
  assert.deepEqual(errored('boom'), { status: 'error', message: 'boom' });
  assert.deepEqual(loaded({ x: 1 }), { status: 'loaded', data: { x: 1 } });
});

test('nextPollTickState only shows loading on the very first fetch, from idle', () => {
  assert.deepEqual(nextPollTickState(idle()), { status: 'loading' });
});

test('nextPollTickState keeps rendering the last error while a background retry is in flight, never flipping back to loading', () => {
  const previous = errored('upstream unreachable');
  assert.deepEqual(nextPollTickState(previous), previous);
});

test('nextPollTickState keeps rendering the last loaded data while a background refresh is in flight, never flipping back to loading', () => {
  const previous = loaded({ decisionId: 'dec_1' });
  assert.deepEqual(nextPollTickState(previous), previous);
});
