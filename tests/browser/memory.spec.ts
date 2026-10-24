import { expect, test } from '@playwright/test';

test('search, evidence, and a report shared between two browser sessions', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A home that remembers.' })).toBeVisible();
  await expect(page.locator('.object-card').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search objects' }).fill('HDMI adapter');
  await expect(page.locator('.object-card')).toHaveCount(1);
  await page.locator('.object-card').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Object location in saved image')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Room', exact: true })
    .selectOption('Kitchen');
  await page.getByLabel('Where is it now?').fill('In the top drawer beside the kettle');
  await page.getByRole('button', { name: 'Update location', exact: true }).click();
  await expect(
    page.getByText('This earlier image shows the previous sighting.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await second.goto('/');
  await second.getByRole('button', { name: 'Household', exact: true }).click();
  await second.getByRole('button', { name: 'View as Alex', exact: true }).click();
  await expect(second.getByRole('button', { name: 'View as Alex', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await second.getByRole('button', { name: 'Close dialog' }).click();
  await second.getByRole('textbox', { name: 'Search objects' }).fill('HDMI adapter');
  await expect(second.locator('.object-card')).toHaveCount(1);
  await expect(second.locator('.object-card')).toContainText('In the top drawer beside the kettle');
  await expect(second.locator('.object-card')).toContainText('Member reported');
  await secondContext.close();
});

test('unknown objects have an honest empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Search objects' }).fill('purple umbrella');
  await expect(page.getByRole('heading', { name: 'No stored match yet.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all memories' }).click();
  await expect(page.locator('.object-card').first()).toBeVisible();
});

test('mobile layout and sample capture remain usable without cloud credentials', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.object-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Remember something' }).click();
  await expect(page.getByText('Sample mode', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add sample observation' }).click();
  await expect(page.getByRole('status')).toContainText('A new observation');
});
