import { expect, test } from '@playwright/test';
import { joinAsGuest } from './guest-helpers';

test('guest entry needs only a name, restores on reload, and leave revokes the session', async ({
  page,
  request,
}) => {
  const protectedPaths: string[] = [];
  page.on('request', (req) => {
    const path = new URL(req.url()).pathname;
    if (['/api/objects', '/api/activity', '/api/demo/session'].includes(path))
      protectedPaths.push(path);
  });
  await page.goto('/');
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue as guest', exact: true })).toBeDisabled();
  await expect(page.locator('input[type="password"], input[type="email"]')).toHaveCount(0);
  expect(protectedPaths).toEqual([]);
  await joinAsGuest(page, '  Guest tester  ');
  await expect(page.locator('.object-card').first()).toBeVisible();
  const session = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  await page.reload();
  await expect(page.locator('.profile strong')).toHaveText('Guest tester');
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Leave guest session', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toBeVisible();
  await expect(page.locator('.object-card')).toHaveCount(0);
  const me = await request.get('/api/me', {
    headers: { Authorization: `Bearer ${session.token}` },
  });
  expect(me.status()).toBe(401);
  expect(protectedPaths).not.toContain('/api/demo/session');
});

test('failed guest entry keeps the name editable and does not fabricate a session', async ({
  page,
}) => {
  await page.route('**/api/guest/session', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Please retry guest entry.' } }),
  );
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Pree');
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Please retry guest entry.');
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveValue('Pree');
  expect(await page.evaluate(() => sessionStorage.getItem('commonplace-guest-session'))).toBeNull();
});

test('saved user picker restores the same user after switching and leaving', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await joinAsGuest(page, 'Picker Pree');
  const first = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Your name' }).fill('Picker Alex');
  await page.getByRole('button', { name: 'Switch guest', exact: true }).click();
  await expect(page.locator('.profile strong')).toHaveText('Picker Alex');
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page
    .getByRole('button', {
      name: new RegExp(`^Use Picker Pree \\(${first.member.id.slice(-6)}\\)$`),
    })
    .click();
  await expect(page.locator('.profile strong')).toHaveText('Picker Pree');
  const restored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  expect(restored.member.id).toBe(first.member.id);
  expect(restored.token).not.toBe(first.token);
  expect(
    (
      await request.get('/api/me', { headers: { Authorization: `Bearer ${first.token}` } })
    ).status(),
  ).toBe(401);
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Leave guest session', exact: true }).click();
  await page
    .getByRole('button', {
      name: new RegExp(`^Use Picker Pree \\(${first.member.id.slice(-6)}\\)$`),
    })
    .click();
  await expect(page.locator('.profile strong')).toHaveText('Picker Pree');
  expect(
    (await page.evaluate(() => JSON.parse(sessionStorage.getItem('commonplace-guest-session')!)))
      .member.id,
  ).toBe(first.member.id);
});

test('unavailable saved-user database displays the failure instead of an empty directory', async ({
  page,
}) => {
  await page.route('**/api/guest/users', (route) =>
    route.fulfill({ status: 503, json: { detail: 'User database is unavailable.' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('User database is unavailable.');
  await expect(page.getByText('No saved users yet. Add the first one below.')).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toBeEnabled();
});
