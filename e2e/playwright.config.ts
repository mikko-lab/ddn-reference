// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';

// Real, no-mocks browser <-> API <-> validators
// <-> receipt <-> anchoring E2E. Deliberately no `webServer` entry --
// unlike the per-app accessibility suites, every real process
// this suite needs (Anvil, apps/api, apps/explorer, apps/demo-negotiation-reference)
// is started, health-checked, and torn down by e2e/src/run-e2e.ts itself,
// since they share real cross-process state (the same deployed contract,
// the same running API, the same validator keys) that a plain per-test
// `webServer` block can't express. Run via `pnpm --filter @ddn/e2e run
// test:e2e`, never `playwright test` directly against a stack this file
// didn't start.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
