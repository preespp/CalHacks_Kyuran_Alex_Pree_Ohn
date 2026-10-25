import { expect, test } from './support/fixtures';
import { installVoiceMocks } from './support/voice-mocks';
import { openAssistant } from './support/assistant-helpers';

test('rapid recognition shutdowns stop bounded retries and leave typing usable', async ({
  page,
}) => {
  await installVoiceMocks(page);
  await page.clock.install();
  await openAssistant(page);
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__voiceTest.endWake());
    await page.clock.runFor(500);
  }
  await expect(page.getByRole('alert')).toContainText('Hands-free listening keeps stopping');
  const starts = await page.evaluate(() => window.__voiceTest.wakeStarts);
  await page.clock.runFor(3000);
  expect(await page.evaluate(() => window.__voiceTest.wakeStarts)).toBe(starts);
  await expect(page.getByRole('textbox', { name: 'Ask about a shared object' })).toBeEnabled();
});

test('unsupported wake recognition retains manual voice and keyboard chat access', async ({
  page,
}) => {
  await installVoiceMocks(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: undefined,
    });
  });
  await openAssistant(page);
  await expect(page.getByRole('button', { name: 'Talk to Remi', exact: true })).toBeEnabled();
  const input = page.getByRole('textbox', { name: 'Ask about a shared object' });
  await input.focus();
  await page.keyboard.type('Where are my glasses?');
  await expect(input).toHaveValue('Where are my glasses?');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});
