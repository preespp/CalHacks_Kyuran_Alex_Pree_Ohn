import { expect, test } from './fixtures';
import { joinAsGuest } from './guest-helpers';

test('household API works and standalone Muse endpoints are retired', async ({ request }) => {
  const household = await request.get('/api/health');
  expect(household.ok()).toBeTruthy();
  expect((await household.json()).memory_provider).toBe('sqlite');
  expect((await request.get('/api/lab/health')).status()).toBe(404);
  expect((await request.post('/api/lab/chat', { data: { message: 'Hi' } })).status()).toBe(404);
  expect((await request.post('/api/chat', { data: { message: 'Hi' } })).status()).toBe(401);
});

test('main menu keeps Ask Muse and removes standalone Muse chat', async ({ page }) => {
  await page.goto('/');
  await joinAsGuest(page);
  await expect(page.getByRole('link', { name: 'Muse chat', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A home that remembers.' })).toBeVisible();
});

test('old Muse bookmarks open the integrated household assistant', async ({ page }) => {
  await page.goto('/muse');
  await expect(page).toHaveURL(/\/\?view=assistant$/);
  await joinAsGuest(page);
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
  await expect(page.getByRole('note', { name: 'About this chat' })).toHaveCount(0);
});

test('unavailable household API shows a recoverable error without a retired chat link', async ({
  page,
}) => {
  await page.route('**/api/guest/session', (route) =>
    route.fulfill({ status: 404, json: { detail: 'Not Found' } }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Your name' }).fill('Pree');
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('We couldn’t open your household');
  await expect(page.getByRole('link', { name: 'Open Muse chat', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue as guest', exact: true })).toBeEnabled();
});
