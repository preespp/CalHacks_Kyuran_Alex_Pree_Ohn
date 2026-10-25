import { blockExternalFonts, expect, test } from './support/fixtures';
import { joinAsGuest } from './support/guest-helpers';

test('search, evidence, and a report shared between two browser sessions', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await joinAsGuest(page);
  await expect(page.getByRole('heading', { name: 'A home that remembers.' })).toBeVisible();
  await expect(page.locator('.object-card').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.getByRole('textbox', { name: 'Search objects' }).fill('HDMI adapter');
  await expect(page.locator('.object-card')).toHaveCount(1);
  await page.locator('.object-card').click();
  await expect(page.getByRole('heading', { name: 'HDMI adapter', exact: true })).toBeVisible();
  const session = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  const update = await page.request.post('/api/objects/adapter/notes', {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { room: 'Kitchen', location: 'In the top drawer beside the kettle', kind: 'moved' },
  });
  expect(update.status()).toBe(201);
  await page.getByRole('button', { name: 'All objects', exact: true }).click();

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage();
  await blockExternalFonts(second);
  await second.goto('/');
  await joinAsGuest(second, 'Alex');
  await second.getByRole('textbox', { name: 'Search objects' }).fill('HDMI adapter');
  await expect(second.locator('.object-card')).toHaveCount(1);
  await expect(second.locator('.object-card')).toContainText('In the top drawer beside the kettle');
  await secondContext.close();
});

test('unknown objects have an honest empty state', async ({ page }) => {
  await page.goto('/');
  await joinAsGuest(page);
  await page.getByRole('textbox', { name: 'Search objects' }).fill('purple umbrella');
  await expect(page.locator('.object-card')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search objects' }).fill('');
  await expect(page.locator('.object-card').first()).toBeVisible();
});

test('mobile layout and camera preview remain available without cloud credentials', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await joinAsGuest(page);
  await expect(page.locator('.object-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(420);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Scan room' }).click();
  await expect(page.getByRole('heading', { name: 'Where are you scanning?' })).toBeVisible();
  await page.getByRole('button', { name: /Continue with / }).click();
  await expect(page.getByRole('heading', { name: 'Choose your camera' })).toBeVisible();
  await expect(
    page.getByText('Remembering new items isn’t available yet', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start camera preview', exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole('combobox', { name: 'Camera mode' }).locator('option[value="memory"]'),
  ).toHaveAttribute('disabled', '');
  await expect(page.getByRole('button', { name: 'Add sample observation' })).toHaveCount(0);
});
