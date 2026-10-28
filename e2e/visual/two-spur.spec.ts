import { fixtureScene } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

test.use({ viewport: VISUAL_VIEWPORT });

// S1-27 から起動時のシーンは自動保存（無ければ空）なので、固定シーンは読み込んで撮る
const twoSpur = fixtureScene('two-spur');

test('固定シーン（12 歯と 24 歯の平歯車）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), twoSpur);
  await prepareCapture(page);
  await captureScene(page, 'two-spur');
});
