import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S2-04: ねじ歯車のかみ合いの拡大。2 枚の歯すじが接点で平行にそろって見え、回転の向きが自然に見えるかは、
// 人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

// A（軸 x、中心 [4, 80, 0]、半径 20）と B（軸 z、中心 [4, 140, 0]、半径 40）の接点は [4, 100, 0]
const TARGET: Vec3 = [4, 100, 0];
// 接点での歯すじの向き (1, 0, 1) と中心を結ぶ線 y のどちらとも直交する向き (1, 0, −1) から、少し上から見る
const CLOSEUP: Vec3 = [74, 120, -70];

test('crossed-helical-closeup（crossed-pair のかみ合いの拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: fixtureScene('crossed-pair') });
  await setCamera(page, { position: CLOSEUP, target: TARGET });
  await prepareCapture(page);
  await captureScene(page, 'crossed-helical-closeup');
});
