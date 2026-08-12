// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Accessibility scan suite. Runs against a real
// `next build && next start` production server -- this repo has already
// hit multiple bugs (see packages/schemas' import.meta.url issue) that
// only reproduce under Turbopack's production bundling, never under
// `next dev` or plain node:test. DDN_API_BASE_URL points at a port
// nothing listens on so upstream fetches fail fast (ECONNREFUSED)
// instead of hanging -- these scans exercise each page's real
// error/empty state, not a live decision pipeline. The full real
// validator/Anvil/receipt/anchor E2E is covered by the real E2E suite, not
// this one.
const PORT = 3210;
const explorerToken = `a11y_explorer_${randomBytes(32).toString('base64url')}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: 'a11y.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: `pnpm exec next build && pnpm exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DDN_API_BASE_URL: 'http://127.0.0.1:1',
      DDN_DEMO_SERVICE_TOKEN: explorerToken,
    },
  },
});
