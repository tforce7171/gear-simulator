import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S2-01: ハスバ歯車のかみ合いの拡大。ねじれの向きと歯幅の端から端までのかみ合いは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

// A（中・20 歯 'right'、中心 [0, 39, 0]）と B（中・40 歯 'left'、中心 [0, 39, 60]）は [0, 39, 20] でかみ合う
const helicalPair = fixtureScene('helical-pair');
const CONTACT: Vec3 = [0, 39, 20];
// 接点の横（+x）から少し上を見る（歯のねじれが見えるように、歯幅の方向（y）を画面の縦に近くする）
const CLOSEUP_DIRECTION: Vec3 = [50, 14, 6];
const CLOSEUP_DISTANCE = 60;

test('helical-closeup（helical-pair のかみ合いの拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  const len = Math.hypot(...CLOSEUP_DIRECTION);
  const k = CLOSEUP_DISTANCE / len;
  const position: Vec3 = [
    CONTACT[0] + CLOSEUP_DIRECTION[0] * k,
    CONTACT[1] + CLOSEUP_DIRECTION[1] * k,
    CONTACT[2] + CLOSEUP_DIRECTION[2] * k,
  ];
  await openApp(page, { scene: helicalPair });
  await setCamera(page, { position, target: CONTACT });
  await prepareCapture(page);
  await captureScene(page, 'helical-closeup');
});
