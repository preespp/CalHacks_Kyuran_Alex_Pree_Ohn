import type { Page } from './fixtures';
import { joinAsGuest } from './guest-helpers';

export function chatReply(answer: string) {
  return {
    provider: 'muse',
    answer,
    query: 'keys',
    matches: [],
    total_matches: 0,
    needs_disambiguation: false,
  };
}

export async function openAssistant(page: Page) {
  const health = await (await page.request.get('/api/health')).json();
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { ...health, assistant_provider: 'muse' },
    }),
  );
  await page.goto('/');
  await joinAsGuest(page, 'Assistant tester');
  await page.getByRole('button', { name: 'Open Remi chat', exact: true }).click();
}
