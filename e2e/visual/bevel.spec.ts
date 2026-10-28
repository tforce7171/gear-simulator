import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S2-02: かさ歯車のかみ合いの拡大。歯が円すいに沿ってすぼまり、頂点の一致したかみ合いに見えるかは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

// A（縦、大端 [0, 35, 0]）と B（軸 'x'、大端 [-20, 55, 0]）の大端のピッチ円は [-20, 35, 0] で接し、頂点は [0, 55, 0]。
// 歯のある部分（大端から頂点へ母線の長さ 8）の中ほどを見る
const bevelPair = fixtureScene('bevel-pair');
const TARGET: Vec3 = [-14, 41, 6];
// かみ合いの外側（−x、−y の向きの、少し手前（+z））から見る
const CLOSEUP_DIRECTION: Vec3 = [-30, -20, 45];
const CLOSEUP_DISTANCE = 60;

test('bevel-closeup（bevel-pair のかみ合いの拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  const len = Math.hypot(...CLOSEUP_DIRECTION);
  const k = CLOSEUP_DISTANCE / len;
  const position: Vec3 = [
    TARGET[0] + CLOSEUP_DIRECTION[0] * k,
    TARGET[1] + CLOSEUP_DIRECTION[1] * k,
    TARGET[2] + CLOSEUP_DIRECTION[2] * k,
  ];
  await openApp(page, { scene: bevelPair });
  await setCamera(page, { position, target: TARGET });
  await prepareCapture(page);
  await captureScene(page, 'bevel-closeup');
});
