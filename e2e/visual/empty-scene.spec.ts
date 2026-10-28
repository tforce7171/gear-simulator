import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

test.use({ viewport: VISUAL_VIEWPORT });

test('空のシーン（床のグリッドだけ）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate(() =>
    window.__gearSim?.loadScene({
      shafts: {},
      gears: {},
      motors: {},
      anchors: {},
      carriers: {},
      racks: {},
    }),
  );
  // 読み込んだシーンが描かれるまで 2 フレーム待つ
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await prepareCapture(page);
  await captureScene(page, 'empty-scene');
});
