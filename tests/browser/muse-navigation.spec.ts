import { expect, test } from '@playwright/test';

test('development proxy keeps household and standalone Muse APIs separate', async ({ request }) => {
  const household = await request.get('/api/health');
  const muse = await request.get('/api/lab/health');
  expect(household.ok()).toBeTruthy();
  expect(muse.ok()).toBeTruthy();
  expect((await household.json()).memory_provider).toBe('sqlite');
  expect((await muse.json()).memory_provider).toBe('none');
});

test('main menu opens independent Muse chat and links back to the household', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Muse chat', exact: true }).click();
  await expect(page).toHaveURL(/\/muse$/);
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A home that remembers.' })).toBeVisible();
});

test('root remains the household homepage even with the obsolete isolated launch flag', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5175/');
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
  await expect(page.getByRole('heading', { name: 'A home that remembers.' })).toBeVisible();
  await page.getByRole('link', { name: 'Muse chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Temporary assistant test mode' })).toContainText(
    'memory is disconnected',
  );
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
});

test('unavailable household API offers the working Muse chat route', async ({ page }) => {
  await page.route('**/api/demo/session', (route) =>
    route.fulfill({ status: 404, json: { detail: 'Not Found' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('household API is unavailable');
  await page.getByRole('link', { name: 'Open Muse chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
});
