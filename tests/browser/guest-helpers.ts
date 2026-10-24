import { expect, type Page } from '@playwright/test';

export async function joinAsGuest(page: Page, name = 'Pree') {
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill(name);
  await page.getByRole('button', { name: 'Continue as guest', exact: true }).click();
  await expect(page.locator('.profile strong')).toHaveText(name.trim());
}
