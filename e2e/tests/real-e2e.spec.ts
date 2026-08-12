// SPDX-License-Identifier: Apache-2.0
import { expect, test } from '@playwright/test';

// This suite drives real browsers against a real, already-running stack
// (see e2e/src/run-e2e.ts: a real ddn-validator release binary + WASM
// policy, a real apps/api + @ddn/coordinator process, a real Anvil node
// with a real deployed DecisionAnchor.sol and an in-process anchor
// worker, and apps/explorer + apps/demo-negotiation-reference as real `next build &&
// next start` production servers) -- nothing here is mocked, and none of
// these env vars have a fallback default: if run-e2e.ts didn't set one,
// this must fail loudly, not guess a URL and quietly test nothing real.
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set by e2e/src/run-e2e.ts before running this suite`);
  return value;
}

const DEMO_REFERENCE_BASE_URL = requiredEnv('E2E_DEMO_REFERENCE_BASE_URL');

// An offer at or above the list price is an immediate, deterministic
// ACCEPT under policies/negotiation-v1's rule table (rule C) -- avoids
// depending on the COUNTER-offer loop's extra round trips for what this
// suite needs to prove (the real infra chain converges and the browser
// can observe every stage of it), which the suite's scope already
// covers via the offer-input unit tests' rule-table coverage.
const ACCEPT_OFFER_EUR = '30000';

test('a real offer submitted from the browser flows through real validators, quorum, receipt verification, and anchoring', async ({ page }) => {
  await test.step('submit a real offer from apps/demo-negotiation-reference and land on its result page', async () => {
    await page.goto(`${DEMO_REFERENCE_BASE_URL}/`);
    await page.getByLabel('Your offer (EUR)').fill(ACCEPT_OFFER_EUR);
    await page.getByLabel('I acknowledge the condition report').check();
    await page.getByRole('button', { name: 'Submit offer' }).click();
    await page.waitForURL(/\/offer\/dec_[A-Za-z0-9_-]+$/, { timeout: 15_000 });
  });

  await test.step('the decision reaches FINALIZED via real validator subprocesses', async () => {
    await expect(page.getByText('FINALIZED', { exact: true })).toBeVisible({ timeout: 20_000 });
  });

  await test.step('real per-validator progress and quorum are visible in the browser', async () => {
    // Three real ddn-validator subprocesses, each a real row; SUCCEEDED
    // is the real terminal phase these particular validators reach for
    // an ACCEPT outcome under the pinned WASM policy.
    await expect(page.getByRole('cell', { name: 'SUCCEEDED' }).first()).toBeVisible({ timeout: 20_000 });
    const succeededCount = await page.getByRole('cell', { name: 'SUCCEEDED' }).count();
    expect(succeededCount, 'expected all three real validator instances to reach SUCCEEDED').toBe(3);
  });

  await test.step('the real receipt is fetched and locally verified against the real trusted demo profile', async () => {
    // Verification runs client-side (@ddn/receipt-sdk's
    // computeVerificationOutcome) against the bundled TrustedDemoProfileV1
    // -- before the real on-chain anchor is available, this is expected
    // to read "Incomplete" (no tamper finding, just nothing to check yet),
    // which the anchor step below upgrades to "Valid".
    await expect(page.getByRole('status').filter({ hasText: /Valid|Incomplete/ }).first()).toBeVisible({ timeout: 20_000 });
  });

  await test.step('the real anchor worker submits and confirms a real on-chain transaction, and the browser shows it', async () => {
    // DecisionDetailClient only auto-fetches the anchor once, right when
    // the decision finalizes -- almost always before the anchor worker
    // (real poll interval + real tx + a real confirmation block) has had
    // time to finish. There is no polling for this specific field by
    // design; a real user re-checks via this same button, so the test
    // does exactly that instead of reaching into internals.
    const refreshButton = page.getByRole('button', { name: 'Refresh anchor status' });
    await expect(async () => {
      await refreshButton.click();
      await expect(page.getByText('Chain ID')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });
  });

  await test.step('local verification upgrades to Valid once the real anchor is available', async () => {
    await expect(page.getByRole('status').filter({ hasText: 'Valid' }).first()).toBeVisible({ timeout: 10_000 });
  });
});
