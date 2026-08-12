// SPDX-License-Identifier: Apache-2.0
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// See apps/explorer/e2e/a11y.spec.ts for why this explicit tag list is
// used instead of AxeBuilder's own defaults.
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'];

async function expectNoViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
}

test('offer form (empty state) has no axe violations', async ({ page }) => {
  await page.goto('/');
  await expectNoViolations(page);
});

test('offer form (validation-error state) has no axe violations', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Your offer (EUR)').fill('-5');
  await page.getByRole('button', { name: 'Submit offer' }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expectNoViolations(page);
});

test('offer result page (unreachable upstream) has no axe violations', async ({ page }) => {
  await page.goto('/offer/dec_a11y_test');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expectNoViolations(page);
});

test('the offer form is fully operable by keyboard, with a visible focus indicator', async ({ page }) => {
  await page.goto('/');

  const offerField = page.getByLabel('Your offer (EUR)');
  await offerField.focus();
  await expect(offerField).toBeFocused();
  const outline = await offerField.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline, 'offer amount field must show a visible focus indicator, not outline: none').not.toBe('none');

  await page.keyboard.type('28000');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('I acknowledge the condition report')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('I acknowledge the condition report')).toBeChecked();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Submit offer' })).toBeFocused();
});

test('every page has exactly one h1 and no skipped heading levels', async ({ page }) => {
  for (const url of ['/', '/offer/dec_a11y_test']) {
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

// See packages/demo-web-kit/src/fetch-state.ts's nextPollTickState -- the
// same shared polling hook backs this offer result page's decision-status
// and validator-progress views.
test('a repeatedly-failing offer-result poll keeps the same alert element mounted, not remounted every tick', async ({ page }) => {
  await page.goto('/offer/dec_a11y_test');
  const alert = page.getByRole('alert').first();
  await expect(alert).toBeVisible();

  const firstHandle = await alert.elementHandle();
  // DecisionDetailClient polls every 1000ms.
  await page.waitForTimeout(3000);
  const secondHandle = await page.getByRole('alert').first().elementHandle();

  const isSameNode = await page.evaluate(([a, b]) => a === b, [firstHandle, secondHandle]);
  expect(isSameNode, 'the alert DOM node was replaced across poll ticks instead of being reused in place').toBe(true);
});
