import { readFileSync } from 'node:fs';
import type { Scene } from '../../src/core/scene/types';
import { test } from '../fixtures/test';
import { captureScene } from '../fixtures/visual';

// S1-27 から起動時のシーンは自動保存（無ければ空）なので、固定シーンは読み込んで撮る
const twoSpur = JSON.parse(
  readFileSync(new URL('../fixtures/two-spur.json', import.meta.url), 'utf8'),
) as Scene;

test('固定シーン（12 歯と 24 歯の平歯車）', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
  await page.evaluate((s) => window.__gearSim?.loadScene(s), twoSpur);
  await captureScene(page, 'two-spur');
});
