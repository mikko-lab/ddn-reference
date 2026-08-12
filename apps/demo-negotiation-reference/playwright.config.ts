// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from '@playwright/test';
import { randomBytes } from 'node:crypto';

// Accessibility scan suite. See apps/explorer's
// own playwright.config.ts for why this runs against a real `next build
// && next start` server and why DDN_API_BASE_URL points at a port
// nothing listens on. The full real validator/Anvil/receipt/anchor E2E
// is covered by the real E2E suite, not this one.
const PORT = 3220;
const serviceToken = `a11y_${randomBytes(32).toString('base64url')}`;

export default defineConfig({
  testDir: './e2e',
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
      DDN_DEMO_REFERENCE_SERVICE_TOKEN: serviceToken,
    },
  },
});
