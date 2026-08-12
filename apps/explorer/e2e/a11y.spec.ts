// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// wcag2a/aa + wcag21a/aa is AxeBuilder's own default rule set; best-practice
// is added on top so rules like heading-order (tagged best-practice, not
// strictly WCAG) are also checked. Passing an explicit list here means an
// upstream axe-core default change can't silently narrow what this suite
// checks.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('home page has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expectNoViolations(page);
});

test('verify page (empty state) has no axe violations', async ({ page }) => {
  await page.goto('/verify');
  await expectNoViolations(page);
});

test('verify page (parse-error state) has no axe violations', async ({ page }) => {
  await page.goto('/verify');
  await page.locator('#receipt-input').fill('not valid json');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expectNoViolations(page);
});

test('public decision detail page (unreachable upstream) has no axe violations', async ({ page }) => {
  await page.goto('/decisions/dec_a11y_test');
  await expect(page.getByText('Could not load decision status').first()).toBeVisible();
  await expectNoViolations(page);
});

test('public validator status page (unreachable upstream) has no axe violations', async ({ page }) => {
  await page.goto('/decisions/dec_a11y_test/validators');
  await expect(page.getByText('Could not load validator progress').first()).toBeVisible();
  await expectNoViolations(page);
});

test('every page has exactly one h1 and no skipped heading levels', async ({ page }) => {
  for (const url of ['/', '/verify']) {
    await page.goto(url);
    const headingLevels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map((el) => Number(el.tagName.slice(1)))
    );
    const h1Count = headingLevels.filter((level) => level === 1).length;
    expect(h1Count, `${url}: expected exactly one h1, found ${h1Count}`).toBe(1);
    for (let i = 1; i < headingLevels.length; i++) {
      const prev = headingLevels[i - 1] ?? 0;
      const current = headingLevels[i] ?? 0;
      expect(current - prev, `${url}: heading level jumped from h${prev} to h${current}`).toBeLessThanOrEqual(1);
    }
  }
});

// See packages/demo-web-kit/src/fetch-state.ts's nextPollTickState: a poll
// that keeps failing must not unmount/remount its role="alert" element on
// every tick -- screen readers announce a freshly-mounted alert every
// time, so that would turn a stalled poll into an unbounded, disruptive
// announcement flood rather than one alert that just persists.
test('a repeatedly-failing validator poll keeps the same alert element mounted, not remounted every tick', async ({ page }) => {
  await page.goto('/decisions/dec_a11y_test/validators');
  const alert = page.getByRole('alert').first();
  await expect(alert).toBeVisible();

  const firstHandle = await alert.elementHandle();
  // The validators page polls every 500ms (see the page component) --
  // waiting a few intervals gives several ticks a chance to have
  // (mis)behaved if the fix regressed.
  await page.waitForTimeout(2000);
  const secondHandle = await page.getByRole('alert').first().elementHandle();

  const isSameNode = await page.evaluate(([a, b]) => a === b, [firstHandle, secondHandle]);
  expect(isSameNode, 'the alert DOM node was replaced across poll ticks instead of being reused in place').toBe(true);
});
