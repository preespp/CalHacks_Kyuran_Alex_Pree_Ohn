import { expect, type Page } from '@playwright/test';

export async function joinAsGuest(page: Page, name = 'Pree') {
  const nameField = page.getByRole('textbox', { name: 'Your name', exact: true });
  if (await nameField.count()) {
    await nameField.fill(name);
    await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
    await expect(page.locator('.profile strong')).toHaveText(name.trim());
    return;
  }
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('commonplace-guest-session')))
    .not.toBeNull();
}
