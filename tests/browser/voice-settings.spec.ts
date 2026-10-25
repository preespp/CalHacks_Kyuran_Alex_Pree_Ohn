import { expect, test } from './fixtures';
import { installVoiceMocks } from './voice-mocks';
import { chatReply, openAssistant } from './assistant-helpers';

test('selected voice and speed apply to previews, answers and greetings after reload', async ({
  page,
}) => {
  await installVoiceMocks(page);
  let chats = 0;
  await page.route('**/api/chat', (route) => {
    chats++;
    return route.fulfill({ json: chatReply('Your keys were last seen on the desk.') });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssistant(page);
  await page.getByText('Voice settings', { exact: true }).click();
  const selector = page.getByRole('combobox', { name: 'Speaking voice' });
  const speed = page.getByRole('slider', { name: 'Speaking speed' });
  await selector.selectOption('test-sam');
  await speed.focus();
  await speed.press('ArrowLeft');
  await expect(speed).toHaveValue('0.9');
  await page.getByRole('button', { name: 'Preview voice', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toEqual({
      text: 'Hello, I’m Muse. I can help you find things around your home.',
      voiceURI: 'test-sam',
      rate: 0.9,
      lang: 'en-GB',
    });
  expect(chats).toBe(0);
  await expect(page.getByRole('log')).not.toContainText('Hello, I’m Muse.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/voice-settings-mobile.png', fullPage: true });
  await page.evaluate(() => window.__voiceTest.finishSpeech());

  await page.reload();
  await page.getByText('Voice settings', { exact: true }).click();
  await expect(selector).toHaveValue('test-sam');
  await expect(speed).toHaveValue('0.9');
  await page.getByRole('checkbox', { name: 'Read replies aloud' }).check();
  await page.getByRole('textbox', { name: 'Ask about a shared object' }).fill('Where are my keys?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({
      text: 'Your keys were last seen on the desk.',
      voiceURI: 'test-sam',
      rate: 0.9,
    });
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await page.getByRole('button', { name: 'Turn on Muse voice', exact: true }).click();
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => window.__voiceTest.wakeStarts)).toBeGreaterThan(0);
  await page.evaluate(() => window.__voiceTest.recognize('Hello'));
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({
      text: 'Hi I am Muse how can I help you today with household stuff',
      voiceURI: 'test-sam',
      rate: 0.9,
    });
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  expect(chats).toBe(1);
});

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
  await page.getByText('Voice settings', { exact: true }).click();
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
