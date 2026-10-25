import { expect, test } from './support/fixtures';

test('navigation keeps the main chat entry and places members below help', async ({ page }) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('button')).toHaveText([
    'Overview',
    /My objects/,
    /Activity/,
    'How it works',
    'Household members',
  ]);
  await expect(
    page.locator('.sidebar').getByRole('button', { name: 'Ask Remi', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Remi chat', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Chat with Remi' })).toBeVisible();
});

test('legacy Muse bookmark opens the integrated chat, and lab endpoints stay retired', async ({
  page,
  request,
}) => {
  await page.goto('/muse');
  await expect(page).toHaveURL(/\/\?view=assistant$/);
  await expect(page.getByRole('dialog', { name: 'Chat with Remi' })).toBeVisible();
  expect((await request.get('/api/lab/health')).status()).toBe(404);
  expect((await request.post('/api/lab/chat', { data: { message: 'Hi' } })).status()).toBe(404);
  expect((await request.post('/api/chat', { data: { message: 'Hi' } })).status()).toBe(401);
});
