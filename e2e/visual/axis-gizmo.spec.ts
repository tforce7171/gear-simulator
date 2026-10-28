import { fixtureScene } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

test.use({ viewport: VISUAL_VIEWPORT });

const twoGears = fixtureScene('two-gears');

// 軸の目印（S1-14）。斜め上からの視点と、平行投影の上からの視点で撮る（見やすさは人が確かめる）
test('軸の目印と平行投影', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((scene) => window.__gearSim?.loadScene(scene), twoGears);
  await page.evaluate(() =>
    window.__gearSim?.setCamera({ position: [120, 160, 200], target: [0, 0, 20] }),
  );
  await page.waitForTimeout(200);
  await prepareCapture(page);
  await captureScene(page, 'axis-gizmo-perspective');
  await page.keyboard.press('Numpad7');
  await page.keyboard.press('Numpad5');
  await page.waitForTimeout(1500);
  await prepareCapture(page);
  await captureScene(page, 'axis-gizmo-ortho-top');
});
