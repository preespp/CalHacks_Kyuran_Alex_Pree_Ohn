import { expect, test, type Page } from './support/fixtures';
import { installCameraMocks } from './support/camera-mocks';

function stats(frame: number, processed = 0) {
  const quality = {
    frame_id: frame,
    width: 640,
    height: 480,
    sharpness: 55,
    brightness: 127,
    quality_score: 55,
  };
  return {
    received_frames: frame,
    received_fps: 0.2,
    quality,
    top_frames: [quality],
    analysis: {
      state: 'waiting',
      processed_frames: processed,
      count: processed ? 1 : 0,
      observed_at: processed ? new Date().toISOString() : null,
      error: null,
    },
  };
}
async function openScan(page: Page, vision = true) {
  await installCameraMocks(page);
  const health = await (await page.request.get('/api/health')).json();
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ...health, vision_provider: vision ? 'gemini' : 'demo' } }),
  );
  await page.route('**/api/camera/streams/*', (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: stats(1).analysis }),
  );
  await page.goto('/');
  await expect(page.locator('.object-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Scan room' }).click();
  await page.getByRole('button', { name: /Continue with/ }).click();
  await expect(page.getByRole('heading', { name: 'Choose your camera' })).toBeVisible();
}
function state(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __cameraTest: {
            streams: number;
            stopped: number;
            denied: boolean;
            jpegQuality: number;
            constraints: MediaStreamConstraints[];
          };
        }
      ).__cameraTest,
  );
}

for (const seconds of [3, 4, 5]) {
  test(`camera defaults to five seconds and supports ${seconds}-second captures`, async ({
    page,
  }) => {
    const bodies: string[] = [];
    await page.route('**/api/camera/frames', (route) => {
      bodies.push(route.request().postData()!);
      return route.fulfill({ json: stats(bodies.length) });
    });
    await openScan(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const interval = page.getByRole('combobox', { name: 'Update frequency' });
    await expect(interval).toHaveValue('5');
    await interval.selectOption(String(seconds));
    await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    await page.clock.runFor(seconds * 1000 - 100);
    expect(bodies).toHaveLength(1);
    await page.clock.runFor(200);
    await expect.poll(() => bodies.length).toBe(2);
    const field = (body: string, name: string) =>
      body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`))?.[1];
    expect(field(bodies[0], 'scan_id')).toBe(field(bodies[1], 'scan_id'));
    expect(field(bodies[0], 'request_id')).not.toBe(field(bodies[1], 'request_id'));
    expect(field(bodies[0], 'analysis_interval')).toBe(String(seconds));
    expect(field(bodies[0], 'memory_enabled')).toBe('true');
    await page.getByRole('button', { name: 'Stop scanning', exact: true }).click();
    await page.clock.runFor(seconds * 2000);
    expect(bodies).toHaveLength(2);
    expect((await state(page)).stopped).toBe(1);
  });
}

test('front camera and JPEG quality reach the capture request', async ({ page }) => {
  let body = '';
  await page.route('**/api/camera/frames', (route) => {
    body = route.request().postData()!;
    return route.fulfill({ json: stats(1) });
  });
  await openScan(page);
  await page.getByRole('combobox', { name: 'Choose camera' }).selectOption('user');
  await page.getByRole('slider', { name: 'Photo quality' }).fill('42');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect.poll(() => body.length).toBeGreaterThan(0);
  expect((await state(page)).jpegQuality).toBe(0.42);
  expect((await state(page)).constraints[0].video).toMatchObject({ facingMode: { ideal: 'user' } });
});

test('closing the scan dialog stops its camera and late frames cannot save a memory', async ({
  page,
}) => {
  let frames = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/camera/frames', async (route) => {
    frames++;
    await held;
    await route.fulfill({ json: stats(frames, 1) }).catch(() => {});
  });
  await openScan(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect.poll(() => frames).toBe(1);
  await page.clock.runFor(16000);
  expect(frames).toBe(1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  expect((await state(page)).stopped).toBe(1);
  release();
  await page.clock.runFor(6000);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('New scan saved! Memory updated.')).toHaveCount(0);
  expect(frames).toBe(1);
});

test('completed analysis closes the scan and refreshes shared memory', async ({ page }) => {
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: stats(1, 1) }));
  await openScan(page);
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('New scan saved! Memory updated.')).toBeVisible();
  expect((await state(page)).stopped).toBe(1);
});

test('preview works without model credentials and does not alter object memory', async ({
  page,
}) => {
  await openScan(page, false);
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('commonplace-guest-session')!).token,
  );
  const headers = { Authorization: `Bearer ${token}` };
  const before = await (await page.request.get('/api/objects', { headers })).json();
  await page.getByRole('button', { name: 'Start camera preview' }).click();
  await expect(page.getByRole('region', { name: 'Picture quality' })).toBeVisible();
  expect(await (await page.request.get('/api/objects', { headers })).json()).toEqual(before);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state(page).then((s) => s.stopped)).toBe(1);
});

test('malformed responses and denied permissions leave camera controls recoverable', async ({
  page,
}) => {
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: { quality: null } }));
  await openScan(page, false);
  await page.getByRole('button', { name: 'Start camera preview' }).click();
  await expect(page.getByRole('alert')).toContainText('We couldn’t update the camera view');
  await expect(page.getByRole('button', { name: 'Start camera preview' })).toBeEnabled();
  await page.evaluate(() => {
    (window as unknown as { __cameraTest: { denied: boolean } }).__cameraTest.denied = true;
  });
  await page.getByRole('button', { name: 'Start camera preview' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
});
