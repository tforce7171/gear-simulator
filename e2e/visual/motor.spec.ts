import type { Vec3 } from '../../src/core/math/vec3';
import type { ThemeId } from '../../src/core/theme';
import { fixtureScene, getLayout, openApp, setCamera } from '../fixtures/sim';
import { expect, test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S4-07: モーターの形（130 型のような円筒の DC モーター、継手と線）を、両テーマで寄って撮る。
// モーターに見えるか・継手の線が見えるかは、人が画像で確かめる（manual-checks.md）

test.use({ viewport: VISUAL_VIEWPORT });

// 縦のシャフト（原点 [0, 35, 0]、範囲 [-4, 12]）の下の端の外に、M のモーター（直径 8・長さ 10.4）
const scene = fixtureScene('one-root-motor');

const SHOTS: Array<{ name: string; theme: ThemeId; selected: boolean }> = [
  { name: 'motor-brass', theme: 'brass', selected: false },
  { name: 'motor-wood', theme: 'wood', selected: false },
  { name: 'motor-brass-selected', theme: 'brass', selected: true },
];

for (const shot of SHOTS) {
  test(`${shot.name}（one-root-motor）`, async ({ page }) => {
    test.setTimeout(90_000);
    await openApp(page, { scene });
    await page.evaluate((theme) => window.__gearSim?.updateSettings({ theme }), shot.theme);
    const shaft = (await getLayout(page)).shafts.shaft_a;
    expect(shaft).toBeDefined();
    // モーターの本体の中心（シャフトの下の端 − すき間 1 − 長さの半分 5.2）を斜め下から見る
    const center: Vec3 = [0, 35 - 4 - 6.2, 0];
    await setCamera(page, {
      position: [center[0] + 22, center[1] + 6, center[2] + 26],
      target: [center[0], center[1] + 2, center[2]],
    });
    if (shot.selected) await page.evaluate(() => window.__gearSim?.select('shaft_a'));
    await prepareCapture(page);
    await captureScene(page, shot.name);
  });
}
