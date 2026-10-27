import { readFileSync } from 'node:fs';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});

test('square-loop: 四角形の閉じる組が contact のかみ合いになる', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), fixture('square-loop'));
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  expect(layout?.meshes.filter((m) => m.source === 'contact')).toHaveLength(1);
});

test('triangle: 正三角形の閉じる組が contact、干渉なし', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), fixture('triangle'));
  const layout = await page.evaluate(() => window.__gearSim?.getLayout());
  expect(layout?.meshes.filter((m) => m.source === 'contact')).toHaveLength(1);
  expect(layout?.interferences).toEqual([]);
});
