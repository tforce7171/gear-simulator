import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Vec3 } from '../../src/core/math/vec3';
import type { Scene } from '../../src/core/scene/types';
import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

// S1-24: 真鍮と木製のテーマを、全体とかみ合いの拡大で撮る（質感・影は人が画像で確かめる）

// 中・大の歯車 6 枚とモーター 1 つ（shaft_s1）。gear_g1（大 24 枚、中心 [0, 36, 0]）と
// gear_g2（大 16 枚、中心 [0, 36, 60]）は [0, 36, 36] 付近でかみ合う
const showcase = JSON.parse(
  readFileSync(new URL('../fixtures/showcase.json', import.meta.url), 'utf8'),
) as Scene;

const OVERVIEW = { position: [150, 170, 200] as Vec3, target: [20, 30, 15] as Vec3 };
// かみ合いの接点から 60 mm ほど離れた所から寄って見る
const CLOSEUP = { position: [48, 62, 52] as Vec3, target: [0, 36, 36] as Vec3 };

async function open(page: Page, theme: 'brass' | 'wood'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), showcase);
  await page.evaluate((t) => window.__gearSim?.updateSettings({ theme: t }), theme);
}

// 全体とかみ合いの拡大は別のテストにする（木目のテクスチャと影の描画が重く、1 つにまとめると時間がかかるため）
for (const theme of ['brass', 'wood'] as const) {
  for (const [suffix, pose] of [
    ['', OVERVIEW],
    ['-mesh-closeup', CLOSEUP],
  ] as const) {
    test(`テーマ ${theme}${suffix}（showcase）`, async ({ page }) => {
      // 寄ると歯車が画面を覆い、環境マップ・影・木目の描画がソフトウェア描画では 1 フレーム数百 ms かかる
      test.setTimeout(90_000);
      await open(page, theme);
      await page.evaluate((p) => window.__gearSim?.setCamera(p), pose);
      await page.waitForTimeout(200);
      await captureScene(page, `theme-${theme}${suffix}`);
    });
  }
}
