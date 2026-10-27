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

test('overlap: 重なる 2 枚の歯車 → interferences が [gear_1, gear_2]', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), fixture('overlap'));
  const interferences = await page.evaluate(() => window.__gearSim?.getLayout().interferences);
  expect(interferences).toEqual([['gear_1', 'gear_2']]);
});

test('two-spur: かみ合っている組は干渉にならない → []', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), fixture('two-spur'));
  const interferences = await page.evaluate(() => window.__gearSim?.getLayout().interferences);
  expect(interferences).toEqual([]);
});
