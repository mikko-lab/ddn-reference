#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const amd64Job = workflow.match(
  /  cross-architecture-amd64:\n([\s\S]*?)(?=\n  [a-z][a-z0-9-]*:\n)/,
)?.[1];

test('experimental amd64 validation reports failure without producing a red commit check', () => {
  assert.ok(amd64Job, 'cross-architecture-amd64 job must exist');
  assert.doesNotMatch(
    amd64Job,
    /^    continue-on-error: true$/m,
    'job-level continue-on-error leaves a red check-run even when the workflow succeeds',
  );
  assert.match(amd64Job, /id: amd64-validation/);
  assert.match(amd64Job, /echo "failed=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(amd64Job, /::warning title=Experimental linux\/amd64 validation failed/);
  assert.match(amd64Job, /^          exit 0$/m);
  assert.match(
    amd64Job,
    /if: steps\.amd64-validation\.outputs\.failed == 'true'/,
    'diagnostics must still run when the experimental validation fails',
  );
});

