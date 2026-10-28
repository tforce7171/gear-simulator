import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-22: ロック（脈打つ赤）と干渉（一定の赤）を人が画像で見比べるための画面

test.use({ viewport: VISUAL_VIEWPORT });

test('lock-red: ロックした 2 枚（lock-opposed）', async ({ page }) => {
  // 2 枚の中心は [0, 4, 0] と [0, 4, 40]（中・20 歯）
  await openApp(page, {
    scene: fixtureScene('lock-opposed'),
    camera: { position: [70, 110, 90] as Vec3, target: [0, 4, 20] as Vec3 },
  });
  // 一時停止中はロックが外れて赤い表示が消えるので、止めない（ロックしていて回らない）
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'lock-red');
});

test('interference-warning: 干渉している 2 枚（overlap）', async ({ page }) => {
  await openApp(page, {
    scene: fixtureScene('overlap'),
    camera: { position: [40, 80, 50] as Vec3, target: [5, 20, 0] as Vec3 },
  });
  await prepareCapture(page);
  await captureScene(page, 'interference-warning');
});
