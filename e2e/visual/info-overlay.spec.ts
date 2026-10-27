import { readFileSync } from 'node:fs';
import type { Scene } from '../../src/core/scene/types';
import { expect, test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

// S1-23: シーン A を情報表示 ON で撮る（ラベルの重なりと矢印の向きを人が画像で確かめる）

const sceneA = JSON.parse(
  readFileSync(new URL('../fixtures/scene-a.json', import.meta.url), 'utf8'),
) as Scene;

test('情報表示 ON（scene-a）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), sceneA);
  // 3 枚の中心は [0, 22, 0]・[0, 22, 24]・[0, 22, 54]
  await page.evaluate(() =>
    window.__gearSim?.setCamera({ position: [70, 110, 45], target: [0, 20, 28] }),
  );
  await page.getByTestId('toolbar-info').click();
  await expect(page.getByTestId('info-label')).toHaveCount(3);
  await page.waitForTimeout(200);
  await captureScene(page, 'info-overlay-on');
});
