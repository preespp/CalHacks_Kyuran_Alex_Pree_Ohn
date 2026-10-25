import { expect, type Page } from '@playwright/test';

// The current prototype starts as Pree; additional names use the saved-member dialog.
export async function joinAsGuest(page: Page, name = 'Pree') {
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('commonplace-guest-session')))
    .not.toBeNull();
  if ((await page.locator('.profile strong').textContent()) === name.trim()) return;
  await page.getByRole('button', { name: 'Household members', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add household member', exact: true }).click();
  await expect(page.locator('.profile strong')).toHaveText(name.trim());
}
