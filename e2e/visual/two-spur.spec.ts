import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

test('固定シーン（12 歯と 24 歯の平歯車）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await captureScene(page, 'two-spur');
});
