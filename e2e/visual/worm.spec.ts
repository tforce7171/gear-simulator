import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S2-03: ウォームギアのかみ合いの拡大と、ホイール側からの駆動でロックした場面。
// ねじ山がホイールの歯を押して進めているように見えるか、ロックの赤い震えが分かりやすいかは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

// W（軸 x、中心 [16, 80, 0]、半径 10）と H（軸 z、中心 [16, 40, 0]、半径 30）の接点は [16, 70, 0]
const TARGET: Vec3 = [16, 70, 0];
// 斜め前（+z）の少し上から見る
const CLOSEUP: Vec3 = [52, 98, 70];

test('worm-closeup（worm-basic のかみ合いの拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: fixtureScene('worm-basic') });
  await setCamera(page, { position: CLOSEUP, target: TARGET });
  await prepareCapture(page);
  await captureScene(page, 'worm-closeup');
});

test('worm-locked（worm-backdrive のロック中）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: fixtureScene('worm-backdrive') });
  await setCamera(page, { position: [90, 110, 150], target: [16, 55, 0] });
  // 一時停止中はロックが外れて赤い表示が消えるので、止めない
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'worm-locked');
});
