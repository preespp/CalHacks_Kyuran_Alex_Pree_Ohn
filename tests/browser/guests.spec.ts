import { expect, test } from './support/fixtures';

async function openMembers(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('commonplace-guest-session')))
    .not.toBeNull();
  await page.getByRole('button', { name: 'Household members', exact: true }).click();
}

test('adding a member requires a name and leaves room for typing', async ({ page }) => {
  await openMembers(page);
  const name = page.getByRole('textbox', { name: 'Your name', exact: true });
  const add = page.getByRole('button', { name: 'Add household member', exact: true });
  await expect(add).toBeDisabled();
  await name.fill('   ');
  await expect(add).toBeDisabled();
  await name.fill('Name-only member');
  await expect(add).toBeEnabled();
  expect((await name.boundingBox())!.width).toBeGreaterThan(250);
  expect((await add.boundingBox())!.y).toBeGreaterThan((await name.boundingBox())!.y);
  await expect(page.locator('input[type="password"],input[type="email"]')).toHaveCount(0);
});

test('failed member creation keeps the name editable and preserves the active session', async ({
  page,
}) => {
  await openMembers(page);
  const session = await page.evaluate(() => sessionStorage.getItem('commonplace-guest-session'));
  await page.route('**/api/guest/session', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Please retry adding this member.' } }),
  );
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Retry member');
  await page.getByRole('button', { name: 'Add household member', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please retry');
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue(
    'Retry member',
  );
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('commonplace-guest-session'))).toBe(
    session,
  );
});

test('unavailable saved-user storage shows an error rather than a fabricated empty directory', async ({
  page,
}) => {
  await page.route('**/api/guest/users', (route) =>
    route.fulfill({ status: 503, json: { detail: 'User database is unavailable.' } }),
  );
  await openMembers(page);
  await expect(page.getByRole('alert')).toContainText('Saved names are unavailable right now.');
  await expect(page.getByText('No saved users yet. Add the first one below.')).toHaveCount(0);
});
