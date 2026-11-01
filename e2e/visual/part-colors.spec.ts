import type { Gear, PartColor, Scene, Shaft } from '../../src/core/scene/types';
import type { ThemeId } from '../../src/core/theme';
import { openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S5-04: 部品ごとの色。真鍮のテーマで真鍮・シルバー・メタリックブルーの歯車を並べた場面（-panel はシルバーを選んで
// プロパティパネルの色の欄も写す）と、木のテーマで木・ダークオーク・シルバー（木のテーマでは自動の明るい木。
// -panel で選んで別の系統の注意書きを写す）の歯車と、自動の濃い木のウォームを並べた場面を撮る（色味はエージェントが
// 画像で確かめ、最終的には人が manual-checks.md で確かめる）

test.use({ viewport: VISUAL_VIEWPORT });

// 縦の起点のシャフトに中・20 歯の平歯車を 1 枚ずつ、x 方向に 60 mm 間隔で並べる（かみ合わない）
function lineup(colors: ReadonlyArray<PartColor | null>, withWorm: boolean): Scene {
  const shafts: Record<string, Shaft> = {};
  const gears: Record<string, Gear> = {};
  colors.forEach((color, i) => {
    const shaftId = `shaft_${i}`;
    const gearId = `gear_${i}`;
    shafts[shaftId] = {
      id: shaftId,
      placement: { kind: 'root', origin: [(i - (colors.length - 1) / 2) * 60, 20, 0], axis: 'y' },
    };
    gears[gearId] = {
      id: gearId,
      kind: 'spur',
      shaftId,
      size: 'M',
      teeth: 20,
      offset: 0,
      ...(color === null ? {} : { color }),
    };
  });
  if (withWorm) {
    // 自動（木のテーマでは濃い木）のウォーム。横のシャフトで手前に置く
    shafts.shaft_w = {
      id: 'shaft_w',
      placement: { kind: 'root', origin: [-20, 14, 50], axis: 'x' },
    };
    gears.gear_w = {
      id: 'gear_w',
      kind: 'worm',
      shaftId: 'shaft_w',
      size: 'M',
      teeth: 1,
      offset: 0,
    };
  }
  return { shafts, gears, motors: {}, anchors: {}, carriers: {}, racks: {} };
}

const SHOTS: Array<{ name: string; theme: ThemeId; scene: Scene; select: string }> = [
  {
    name: 'part-colors-brass',
    theme: 'brass',
    scene: lineup(['brass', 'silver', 'metallicBlue'], false),
    select: 'gear_1',
  },
  {
    name: 'part-colors-wood',
    theme: 'wood',
    scene: lineup(['wood', 'darkOak', 'silver'], true),
    select: 'gear_2',
  },
];

for (const shot of SHOTS) {
  test(`${shot.name}: 色を付けた歯車を並べて撮る`, async ({ page }) => {
    await openApp(page, { scene: shot.scene });
    await page.evaluate((theme) => window.__gearSim?.updateSettings({ theme }), shot.theme);
    await setCamera(page, { position: [0, 170, 190], target: [0, 15, 15] });
    await prepareCapture(page);
    await captureScene(page, shot.name);
    // 歯車を選んで、プロパティパネルの色の欄を写す
    await page.evaluate((id) => window.__gearSim?.select(id), shot.select);
    await prepareCapture(page);
    await captureScene(page, `${shot.name}-panel`);
  });
}
