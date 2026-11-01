import type { Vec3 } from '../../src/core/math/vec3';
import type { Gear, Scene } from '../../src/core/scene/types';
import { centerOf, fixtureScene, getLayout, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S5-01: 薄い歯車（1 mm と 8 mm、0.5 mm と 8 mm の組）を斜めと真横から撮る。薄い板として破綻なく描かれるか
// （影・縁の見え方）をエージェントが画像で確かめる（最終的には人が manual-checks.md で確かめる）

test.use({ viewport: VISUAL_VIEWPORT });

// two-gears: gear_1（起点の縦のシャフト）と gear_2（外周）。どちらも中・20 歯
function withWidths(w1: number, w2: number): Scene {
  const base = fixtureScene('two-gears');
  const g1 = base.gears.gear_1 as Gear;
  const g2 = base.gears.gear_2 as Gear;
  return {
    ...base,
    gears: { ...base.gears, gear_1: { ...g1, width: w1 }, gear_2: { ...g2, width: w2 } },
  };
}

for (const [w1, name] of [
  [1, 'thin-gears-1mm'],
  [0.5, 'thin-gears-0.5mm'],
] as const) {
  test(`${name}: ${w1} mm と 8 mm の平歯車を斜めと真横から`, async ({ page }) => {
    await openApp(page, { scene: withWidths(w1, 8) });
    const layout = await getLayout(page);
    const a = centerOf(layout, 'gear_1');
    const b = centerOf(layout, 'gear_2');
    const target: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    await setCamera(page, { position: [target[0] + 50, target[1] + 45, target[2] + 70], target });
    await prepareCapture(page);
    await captureScene(page, `${name}-oblique`);
    // 真横: 2 枚の中心を結ぶ線と直交する水平の向きから（2 枚が並んで見える）
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    const side: Vec3 = [target[0] + (-dz / len) * 110, target[1] + 2, target[2] + (dx / len) * 110];
    await setCamera(page, { position: side, target });
    await prepareCapture(page);
    await captureScene(page, `${name}-side`);
  });
}
