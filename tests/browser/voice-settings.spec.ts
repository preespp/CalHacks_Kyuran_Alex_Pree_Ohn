import { expect, test } from './support/fixtures';
import { installVoiceMocks } from './support/voice-mocks';
import { openAssistant } from './support/assistant-helpers';

test('late-loading and unavailable voices fall back safely and update when available', async ({
  page,
}) => {
  await installVoiceMocks(page);
  await page.addInitScript(() => {
    window.__voiceTest.setVoices([]);
    localStorage.setItem(
      'commonplace.speech-output',
      JSON.stringify({ voiceURI: 'test-sam', rate: 1.2 }),
    );
  });
  await openAssistant(page);
  await page.getByRole('button', { name: 'Close Remi chat' }).click();
  await page.getByText('Remi voice settings', { exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Speaking voice' });
  await expect(selector).toHaveValue('test-sam');
  await expect(selector.locator('option:checked')).toContainText('Saved voice unavailable');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({
      voiceURI: '',
      rate: 1.2,
    });
  await page.evaluate(() => {
    window.__voiceTest.finishSpeech();
    window.__voiceTest.setVoices([
      { voiceURI: 'test-sam', name: 'Sam', lang: 'en-GB', default: false, localService: true },
    ]);
  });
  await expect(selector.locator('option:checked')).toHaveText('Sam (en-GB)');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({
      voiceURI: 'test-sam',
      lang: 'en-GB',
      rate: 1.2,
    });
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await selector.selectOption('');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({
      voiceURI: '',
      rate: 1.2,
    });
  await page.evaluate(() => window.__voiceTest.finishSpeech());
});
