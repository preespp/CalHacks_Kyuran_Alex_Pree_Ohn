import { expect, test, type Page } from './support/fixtures';
import type { MemoryObject } from '../../apps/web/src/types';

const rooms = [
  'Living room',
  'Kitchen',
  'Bedroom',
  'Bathroom',
  'Office',
  'Entryway',
  'Dining room',
  'Studio',
];
function objectIn(room: string, index: number): MemoryObject {
  const id = `room-item-${index}`;
  const latest = {
    id: `sighting-${index}`,
    object_id: id,
    room,
    location: `On the shelf in ${room}`,
    image_url: null,
    bbox: null,
    source: 'gemini' as const,
    observed_at: new Date(Date.now() - index * 60000).toISOString(),
    kind: 'seen' as const,
  };
  return {
    id,
    label: `Item ${index}`,
    appearance: 'A saved household item',
    aliases: [],
    latest,
    last_visual: latest,
  };
}
async function prepare(page: Page, getObjects = () => rooms.map(objectIn)) {
  await page.route('**/api/objects', (route) => route.fulfill({ json: { objects: getObjects() } }));
  await page.route('**/api/activity', (route) => route.fulfill({ json: { events: [] } }));
  await page.goto('/');
  await expect(page.locator('.object-card').first()).toBeVisible();
}
async function myObjects(page: Page) {
  await page.getByRole('button', { name: /^My objects/ }).click();
  await expect(page.locator('.embedded-map-space')).toBeVisible();
}

test('room categories render distinct furnishings and filter interactive pins to their own room', async ({
  page,
}) => {
  await prepare(page);
  await myObjects(page);
  await expect(page.locator('.household-room-tile')).toHaveCount(8);
  const signatures = new Set<string>();
  for (const room of rooms) {
    await page.locator('.space-pill').filter({ hasText: room }).click();
    const scene = page.locator('.embedded-map-space .category-room-scene');
    await expect(scene).toHaveAttribute('data-room-name', room);
    await expect(scene.getByRole('img', { name: `${room} illustration` })).toBeVisible();
    const pins = scene.locator('button.room-object-pin');
    await expect(pins).toHaveCount(1);
    await pins.click();
    await expect(pins).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.map-active-bar')).toContainText(room);
    signatures.add(await scene.locator('svg').evaluate((svg) => svg.innerHTML));
  }
  expect(signatures.size).toBe(rooms.length);
  await page.screenshot({ path: 'test-results/room-studio.png' });
  await page.locator('.space-pill').filter({ hasText: 'All Spaces' }).click();
  await expect(page.locator('.household-room-tile')).toHaveCount(8);
  await page.screenshot({ path: 'test-results/room-all-spaces.png', fullPage: true });
});

test('a newly observed custom room appears on refresh with its own stable scene', async ({
  page,
}) => {
  let objects = [objectIn('Kitchen', 1)];
  await prepare(page, () => objects);
  await myObjects(page);
  await page.clock.install();
  objects = [...objects, objectIn('Music nook', 2)];
  await page.clock.runFor(5100);
  await page.locator('.space-pill').filter({ hasText: 'Music nook' }).click();
  const scene = page.locator('.embedded-map-space .category-room-scene');
  await expect(scene).toHaveAttribute('data-room-category', 'custom');
  await expect(scene).toHaveAttribute('data-room-name', 'Music nook');
  await expect(scene.locator('[data-furniture="sofa"]')).toHaveCount(0);
  const furnishings = await scene.locator('svg').innerHTML();
  await page.reload();
  await myObjects(page);
  await page.locator('.space-pill').filter({ hasText: 'Music nook' }).click();
  expect(await scene.locator('svg').innerHTML()).toBe(furnishings);
});

test('overview and object details use the saved room category with honest illustration labels', async ({
  page,
}) => {
  const objects = [objectIn('Living room', 1), objectIn('Kitchen', 0)];
  await prepare(page, () => objects);
  const preview = page.locator('.scene-card .category-room-scene');
  await expect(preview).toHaveAttribute('data-room-name', 'Kitchen');
  await expect(preview).toHaveAttribute('data-room-category', 'kitchen');
  await expect(preview.locator('.room-object-pin')).toHaveCount(1);
  await expect(preview).not.toContainText('Item 1');
  await preview.getByRole('button', { name: 'Select Item 0 in Kitchen' }).click();
  const detail = page.locator('.detail-scene-card .category-room-scene');
  await expect(detail).toHaveAttribute('data-room-category', 'kitchen');
  await expect(detail).toContainText('Illustrated layout');
  await expect(detail).toContainText('Pins are not measured positions');
  await expect(page.locator('.detail-scene-card')).not.toContainText(/Measured depth|98%/);
});

test('selecting an item outside the first four keeps its pin visible and usable with the keyboard', async ({
  page,
}) => {
  await prepare(page, () => Array.from({ length: 7 }, (_, index) => objectIn('Kitchen', index)));
  await myObjects(page);
  await page.locator('.space-pill').filter({ hasText: 'Kitchen' }).click();
  await page.locator('.map-object-card').filter({ hasText: 'Item 6' }).click();
  const pin = page.getByRole('button', { name: 'Select Item 6 in Kitchen' });
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute('aria-pressed', 'true');
  await pin.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.map-active-bar')).toContainText('Item 6');
});

test('room illustrations and category selection fit a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await myObjects(page);
  await page.locator('.space-pill').filter({ hasText: 'Bathroom' }).click();
  await expect(page.getByRole('img', { name: 'Bathroom illustration' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/room-bathroom-mobile.png', fullPage: true });
});
