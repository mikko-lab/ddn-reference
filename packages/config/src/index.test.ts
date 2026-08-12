// SPDX-License-Identifier: Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packageName } from './index.js';

test('@ddn/config scaffold exports its own package name', () => {
  assert.equal(packageName, '@ddn/config');
});
