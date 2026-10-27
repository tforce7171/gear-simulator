import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

test('空のシーン（床のグリッドだけ）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await captureScene(page, 'empty-scene');
});
