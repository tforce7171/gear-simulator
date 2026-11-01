import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S5-05: 欠け歯車。見本「ラック往復」の全体と、欠け歯車・中間歯車とラックのかみ合いの拡大。
// 歯のない部分が歯底円の弧になっているか、中間歯車の歯がラックの歯溝に入って見えるかを、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

const reciprocation = fixtureScene('rack-reciprocation');

test('rack-reciprocation（見本「ラック往復」の全体）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: reciprocation });
  // 斜め前の上から。A（手前の面 z 0〜4）と B・中間歯車（奥の面 z 8〜12）、その下のラック
  await setCamera(page, { position: [70, 75, 120] as Vec3, target: [0, 28, 6] as Vec3 });
  await prepareCapture(page);
  await captureScene(page, 'rack-reciprocation');
});

test('partial-gear-closeup（欠け歯車 A の歯のない部分と、中間歯車とラックのかみ合いの拡大）', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: reciprocation });
  // 斜め前の下から、中間歯車（手前の面 z 8〜12）とラックの接点 [0, 20.5, 10] と、その奥の A の歯のない部分
  await setCamera(page, { position: [-30, 12, 60] as Vec3, target: [0, 24, 6] as Vec3 });
  await prepareCapture(page);
  await captureScene(page, 'partial-gear-closeup');
});
