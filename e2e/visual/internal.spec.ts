import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S3-02: 内歯車のかみ合いの拡大。内歯の形が自然で、かみ合った平歯車と内歯がめり込んで見えないか、
// カップ形のウェブが内側を見る邪魔にならないかは、人が画像で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

// P（中・20 歯、中心 [0, 39, 0]）と内歯車 G（中・60 歯、中心 [0, 39, 40]、ウェブは下）は、
// P の中心から G と反対の側の [0, 39, −20] でかみ合う
const internalPair = fixtureScene('internal-pair');
const CONTACT: Vec3 = [0, 39, -20];
// 開いている側（上）から、接点を斜めに見下ろす
const CLOSEUP_DIRECTION: Vec3 = [25, 70, -35];
const CLOSEUP_DISTANCE = 70;

test('internal-closeup（internal-pair を開いている側から見た拡大）', async ({ page }) => {
  test.setTimeout(90_000);
  const len = Math.hypot(...CLOSEUP_DIRECTION);
  const k = CLOSEUP_DISTANCE / len;
  const position: Vec3 = [
    CONTACT[0] + CLOSEUP_DIRECTION[0] * k,
    CONTACT[1] + CLOSEUP_DIRECTION[1] * k,
    CONTACT[2] + CLOSEUP_DIRECTION[2] * k,
  ];
  await openApp(page, { scene: internalPair });
  await setCamera(page, { position, target: CONTACT });
  await prepareCapture(page);
  await captureScene(page, 'internal-closeup');
});
