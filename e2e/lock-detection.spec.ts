import { readFileSync } from 'node:fs';
import type { Scene } from '../src/core/scene/types';
import { expect, test } from './fixtures/test';

function fixture(name: string): Scene {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  ) as Scene;
}

const stalemate = fixture('stalemate');
const twoSpur = fixture('two-spur');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__gearSim?.isReady() === true);
});

test('stalemate: 12 歯どうしに同じ向きの S 60rpm → ロックし、角度が変わらない', async ({
  page,
}) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), stalemate);
  const before = await page.evaluate(() => window.__gearSim?.getMotion());
  expect(before?.locks[0]?.reason).toBe('stalemate');
  expect(before?.locks[0]?.shaftIds).toEqual(['shaft_1', 'shaft_2']);
  expect(before?.locks[0]?.gearIds).toEqual(['gear_1', 'gear_2']);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => window.__gearSim?.getMotion());
  expect(after?.locks[0]?.reason).toBe('stalemate');
  expect(after?.angles).toEqual(before?.angles);
});

test('two-spur.json: ロックなし、ω の比は −0.5', async ({ page }) => {
  await page.evaluate((s) => window.__gearSim?.loadScene(s), twoSpur);
  const motion = await page.evaluate(() => window.__gearSim?.getMotion());
  expect(motion?.locks).toEqual([]);
  expect(motion?.backDriven).toEqual([]);
  const w1 = motion?.omegas.shaft_1 ?? Number.NaN;
  const w2 = motion?.omegas.shaft_2 ?? Number.NaN;
  expect(w2 / w1).toBeCloseTo(-0.5, 6);
});
