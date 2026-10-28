import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, getMotion, openApp, setCamera } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S3-04: ラック＆ピニオン。歯がずれずにかみ合って見えるか、端で止まったときのロックの表示が「端に当たった」と
// 分かるかは、人が画像（と画面）で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

const rackBasic = fixtureScene('rack-basic');

test('rack-closeup（rack-basic のかみ合い部分の拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: rackBasic });
  // 接点 [0, 40, 4] を正面の少し上から
  await setCamera(page, { position: [18, 52, 70] as Vec3, target: [0, 40, 4] as Vec3 });
  await prepareCapture(page);
  await captureScene(page, 'rack-closeup');
});

test('rack-end-locked（端でロックした場面）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: rackBasic });
  await setCamera(page, { position: [60, 90, 260] as Vec3, target: [40, 45, 4] as Vec3 });
  await expect
    .poll(async () => (await getMotion(page)).locks.map((l) => l.reason), { timeout: 30_000 })
    .toEqual(['rackEnd']);
  await prepareCapture(page, { pause: false });
  await captureScene(page, 'rack-end-locked');
});
