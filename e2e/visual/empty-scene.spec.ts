import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

test('空のシーン（床のグリッドだけ）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate(() => window.__gearSim?.loadScene({ shafts: {}, gears: {}, motors: {} }));
  // 読み込んだシーンが描かれるまで 2 フレーム待つ
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await captureScene(page, 'empty-scene');
});
