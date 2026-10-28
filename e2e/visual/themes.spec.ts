import type { Vec3 } from '../../src/core/math/vec3';
import type { Quality, ThemeId } from '../../src/core/theme';
import { fixtureScene, openApp, setCamera } from '../fixtures/sim';
import { test } from '../fixtures/test';
import { captureScene, prepareCapture, VISUAL_VIEWPORT } from '../fixtures/visual';

// S1-24・S1-31: 真鍮と木製のテーマを、全体（Home）とかみ合いの拡大で撮る。真鍮は軽量でも撮る
// （質感・影は人が画像で確かめる）

test.use({ viewport: VISUAL_VIEWPORT });

// 中・大の歯車 6 枚とモーター 1 つ（shaft_s1）。gear_g1（大 24 枚、中心 [0, 36, 0]）と
// gear_g2（大 16 枚、中心 [0, 36, 60]）は [0, 36, 36] 付近でかみ合う
const showcase = fixtureScene('showcase');

// かみ合いの接点から 60 mm 離れた所から寄って見る
const CONTACT: Vec3 = [0, 36, 36];
const CLOSEUP_DIRECTION: Vec3 = [48, 26, 16];
const CLOSEUP_DISTANCE = 60;

function closeup(): { position: Vec3; target: Vec3 } {
  const len = Math.hypot(...CLOSEUP_DIRECTION);
  const k = CLOSEUP_DISTANCE / len;
  return {
    position: [
      CONTACT[0] + CLOSEUP_DIRECTION[0] * k,
      CONTACT[1] + CLOSEUP_DIRECTION[1] * k,
      CONTACT[2] + CLOSEUP_DIRECTION[2] * k,
    ],
    target: CONTACT,
  };
}

const SHOTS: Array<{ name: string; theme: ThemeId; quality: Quality; closeup: boolean }> = [
  { name: 'theme-brass', theme: 'brass', quality: 'high', closeup: false },
  { name: 'theme-wood', theme: 'wood', quality: 'high', closeup: false },
  { name: 'theme-brass-mesh-closeup', theme: 'brass', quality: 'high', closeup: true },
  { name: 'theme-wood-mesh-closeup', theme: 'wood', quality: 'high', closeup: true },
  { name: 'theme-brass-low', theme: 'brass', quality: 'low', closeup: false },
];

// 場面ごとに別のテストにする（木目のテクスチャと影の描画が重く、1 つにまとめると時間がかかるため）
for (const shot of SHOTS) {
  test(`${shot.name}（showcase）`, async ({ page }) => {
    // 寄ると歯車が画面を覆い、環境マップ・影・木目の描画がソフトウェア描画では 1 フレーム数百 ms かかる
    test.setTimeout(90_000);
    await openApp(page, { scene: showcase });
    await page.evaluate(
      (s) => window.__gearSim?.updateSettings({ theme: s.theme, quality: s.quality }),
      shot,
    );
    if (shot.closeup) await setCamera(page, closeup());
    else await page.keyboard.press('Home');
    await prepareCapture(page);
    await captureScene(page, shot.name);
  });
}
