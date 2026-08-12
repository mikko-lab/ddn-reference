// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnchorChainClient, AnchorSidecarStore, AnchorWorker, DECISION_ANCHOR_ABI } from './index.js';

test('@ddn/anchor-service exports its Milestone 6 public surface', () => {
  assert.equal(typeof AnchorChainClient, 'function');
  assert.equal(typeof AnchorSidecarStore, 'function');
  assert.equal(typeof AnchorWorker, 'function');
  assert.ok(Array.isArray(DECISION_ANCHOR_ABI));
});
