import { expect, test } from './support/fixtures';
import { joinAsGuest } from './support/guest-helpers';
import { installVoiceMocks } from './support/voice-mocks';
import { openAssistant } from './support/assistant-helpers';

test('disabled assistant preserves ordinary memory search', async ({ page }) => {
  await page.goto('/');
  await joinAsGuest(page);
  await page.getByRole('button', { name: 'Open Remi chat' }).click();
  await expect(page.getByText('Remi assistant is not enabled yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close Remi chat' }).click();
  await page.getByRole('textbox', { name: 'Search objects' }).fill('keys');
  await expect(page.locator('.object-card')).toHaveCount(1);
});

test('retrieved evidence opens saved details and profile switching clears chat', async ({
  page,
}) => {
  await installVoiceMocks(page);
  const histories: unknown[][] = [];
  await page.route('**/api/chat', async (route) => {
    histories.push(route.request().postDataJSON().history);
    const response = await page.request.get('/api/connector/search?q=keys', {
      headers: { Authorization: route.request().headers()['authorization'] },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    await route.fulfill({
      json: {
        provider: 'muse',
        answer: 'The sample illustration shows the house keys on the desk.',
        query: 'keys',
        matches: result.matches,
        total_matches: result.matches.length,
        needs_disambiguation: false,
      },
    });
  });
  await openAssistant(page);
  const input = page.getByRole('textbox', { name: 'Ask about a shared object' });
  await input.fill('Where are our keys?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Sample illustration');
  expect(histories[0]).toEqual([]);
  await page.locator('.assistant-record').click();
  await expect(page.getByRole('heading', { name: 'House keys', exact: true })).toBeVisible();
  await expect(page.getByLabel('Object location in saved image')).toBeVisible();
  await page.getByRole('button', { name: 'All objects', exact: true }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Open Remi chat' }).click();
  await expect(page.getByRole('log')).toContainText('Where are our keys?');
  await page.getByRole('button', { name: 'Close Remi chat' }).click();
  await page.getByRole('button', { name: 'Household members' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('Fresh chat member');
  await page.getByRole('button', { name: 'Add household member' }).click();
  await expect(page.locator('.profile strong')).toHaveText('Fresh chat member');
  await page.getByRole('button', { name: 'Open Remi chat' }).click();
  await expect(page.getByRole('log')).not.toContainText('Where are our keys?');
  await expect(input).toHaveValue('');
});
