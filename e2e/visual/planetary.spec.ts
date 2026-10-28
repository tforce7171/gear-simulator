import type { Vec3 } from '../../src/core/math/vec3';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S3-03: 遊星歯車機構を斜め上から。遊星が自転しながら公転する様子が歯のめり込みなく見えるか、
// 同じ線上の 3 本のシャフト（太陽・キャリア・リング）が入れ子に見えるかは、人が画像（と画面）で確かめる

test.use({ viewport: VISUAL_VIEWPORT });

const ringFixed = fixtureScene('planetary-ring-fixed');
const TARGET: Vec3 = [0, 64, 0];
const POSITION: Vec3 = [80, 190, 140];

test('planetary（planetary-ring-fixed を斜め上から）', async ({ page }) => {
  test.setTimeout(90_000);
  await openApp(page, { scene: ringFixed });
  await setCamera(page, { position: POSITION, target: TARGET });
  await prepareCapture(page);
  await captureScene(page, 'planetary');
});
